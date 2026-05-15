'use server'

/**
 * Queue-side mutations.
 *
 * For now there's no exclusive lock on trajectories — two annotators can
 * work on the same trajectory and their marks both land (IAA path handles
 * the consensus). So "claim" isn't necessary; "skip" is the only useful
 * mutation: lets an annotator move a trajectory out of their personal
 * queue without committing any marks. We do that by emitting a
 * `queue.skipped` event that the queue query reads to suppress the row.
 *
 * Why an event + filter instead of a `queue_skips` table:
 *   - One source of truth (events log already exists, audit-friendly)
 *   - No migration; no schema sprawl for a small feature
 *   - Skip is reversible — just emit a `queue.unskipped` event later
 *     and the suppress filter sees through it
 */

import { z } from 'zod'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  events,
  trajectories,
  workspaceMembers,
} from '@/lib/db/schema'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import {
  requireUser,
  requireWorkspaceMember,
} from '@/lib/auth/guards'
import { uuidLike } from '@/lib/validators/uuid'

const skipSchema = z.object({
  trajectoryId: uuidLike,
  /** Optional one-line reason — surfaces on the audit log for admin review. */
  reason: z.string().max(280).optional(),
})

/**
 * Skip a trajectory in my queue. The trajectory still exists in the
 * workspace and other annotators see it normally; only my queue
 * suppresses it on subsequent loads.
 *
 * Requires: signed-in user who is a workspace member (any role).
 * Viewers can call too — skipping is just a personal preference, not
 * a mutation of shared data.
 */
export async function skipTrajectory(
  input: z.infer<typeof skipSchema>,
): Promise<{ ok: true; eventId: string }> {
  const parsed = skipSchema.parse(input)
  const me = await requireUser()
  const db = getDb()

  // Resolve trajectory → workspaceId. Defends against a malicious
  // trajectoryId that points to a workspace I don't belong to (no
  // sense letting me create events in someone else's audit log).
  const [traj] = await db
    .select({ workspaceId: trajectories.workspaceId })
    .from(trajectories)
    .where(eq(trajectories.id, parsed.trajectoryId))
    .limit(1)
  if (!traj) throw new NotFoundError('Trajectory')
  try {
    await requireWorkspaceMember(traj.workspaceId)
  } catch {
    throw new ForbiddenError('Not a member of this workspace.')
  }

  const [evt] = await db
    .insert(events)
    .values({
      type: 'queue.skipped',
      workspaceId: traj.workspaceId,
      actorId: me.id,
      payload: {
        trajectoryId: parsed.trajectoryId,
        reason: parsed.reason ?? null,
      },
    })
    .returning({ id: events.id })

  return { ok: true, eventId: evt.id }
}

const unskipSchema = z.object({
  trajectoryId: uuidLike,
})

/**
 * Undo a skip — emit `queue.unskipped` so the queue query stops
 * filtering this trajectory out. Idempotent: emitting twice is fine.
 */
export async function unskipTrajectory(
  input: z.infer<typeof unskipSchema>,
): Promise<{ ok: true }> {
  const parsed = unskipSchema.parse(input)
  const me = await requireUser()
  const db = getDb()

  const [traj] = await db
    .select({ workspaceId: trajectories.workspaceId })
    .from(trajectories)
    .where(eq(trajectories.id, parsed.trajectoryId))
    .limit(1)
  if (!traj) throw new NotFoundError('Trajectory')
  try {
    await requireWorkspaceMember(traj.workspaceId)
  } catch {
    throw new ForbiddenError('Not a member of this workspace.')
  }

  await db.insert(events).values({
    type: 'queue.unskipped',
    workspaceId: traj.workspaceId,
    actorId: me.id,
    payload: { trajectoryId: parsed.trajectoryId },
  })

  return { ok: true }
}

/**
 * Read-side helper for the queue query: returns the set of trajectory
 * IDs the user has actively skipped (skip event after the most recent
 * unskip event, if any). Exported so `listMyQueueForUser` can call it
 * without duplicating the event-scan logic.
 */
export async function getActiveSkipsForUser(opts: {
  userId: string
  workspaceIds: string[]
}): Promise<Set<string>> {
  if (opts.workspaceIds.length === 0) return new Set()
  const db = getDb()
  const rows = await db
    .select({
      ts: events.ts,
      type: events.type,
      payload: events.payload,
    })
    .from(events)
    .where(
      and(
        eq(events.actorId, opts.userId),
        inArray(events.type, ['queue.skipped', 'queue.unskipped']),
        inArray(events.workspaceId, opts.workspaceIds),
      ),
    )
    .orderBy(desc(events.ts))

  // For each trajectory, the FIRST event we see (newest) is the active
  // state. If it's skipped, suppress; if unskipped, don't.
  const seen = new Set<string>()
  const skipped = new Set<string>()
  for (const r of rows) {
    const p = (r.payload ?? {}) as { trajectoryId?: string }
    const tid = p.trajectoryId
    if (!tid || seen.has(tid)) continue
    seen.add(tid)
    if (r.type === 'queue.skipped') skipped.add(tid)
  }
  return skipped
}

/**
 * Convenience: which workspaces is the user an annotator/admin of?
 * Used by the queue page to render the workspace selector.
 */
export async function listMyAnnotatableWorkspaces(opts: {
  userId: string
}): Promise<
  Array<{
    workspaceId: string
    workspaceName: string
    role: 'admin' | 'annotator'
  }>
> {
  const db = getDb()
  const { workspaces } = await import('@/lib/db/schema')
  const rows = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      workspaceName: workspaces.name,
      adminId: workspaces.adminId,
      deletedAt: workspaces.createdAt, // workspaces table has no deletedAt; placeholder
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, opts.userId))

  return rows
    .filter((r) => r.role === 'admin' || r.role === 'annotator')
    .map((r) => ({
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      role: r.role as 'admin' | 'annotator',
    }))
}
