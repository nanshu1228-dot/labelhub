'use server'

/**
 * Submit a per-dimension trajectory comparison.
 *
 * Records the winner choices in the `events` table (no dedicated comparisons
 * table for MVP — comparisons are workspace-level events, not their own
 * lifecycle). Later we can promote to a `comparisons` table if we want
 * dedicated indexes / a leaderboard / dispute resolution against comparisons.
 *
 * Anti-cheat note: comparisons are tied to (workspaceId, trajectoryAId,
 * trajectoryBId, actorId). A raterthat re-submits over and over creates
 * separate events — downstream aggregation should dedupe by latest-per-pair
 * if needed.
 */

import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import { events, trajectories } from '@/lib/db/schema'
import { AppError, NotFoundError, ForbiddenError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { requireWorkspaceMember } from '@/lib/auth/guards'

const winnerSchema = z.enum(['A', 'tie', 'B'])

const inputSchema = z.object({
  workspaceId: uuidLike,
  trajectoryAId: uuidLike,
  trajectoryBId: uuidLike,
  /** Dimension id → winner. e.g. { tool_choice: 'A', goal_achieved: 'tie' }. */
  winners: z.record(z.string().min(1).max(64), winnerSchema),
  reason: z.string().max(4000).optional(),
})

export interface SubmitComparisonResult {
  ok: true
  eventId: string
  workspaceId: string
}

export async function submitComparison(
  input: z.infer<typeof inputSchema>,
): Promise<SubmitComparisonResult> {
  const parsed = inputSchema.parse(input)
  // Comparison submission is an annotator-level action — admins and
  // annotators can submit; viewers can't (read-only).
  const { user, role } = await requireWorkspaceMember(parsed.workspaceId)
  if (role === 'viewer') {
    throw new ForbiddenError(
      'Viewers cannot submit comparisons. Ask an admin to upgrade your role.',
    )
  }
  const db = getDb()

  if (parsed.trajectoryAId === parsed.trajectoryBId) {
    throw new AppError(
      'SAME_TRAJECTORY',
      'Cannot compare a trajectory against itself.',
      400,
    )
  }
  if (Object.keys(parsed.winners).length === 0) {
    throw new AppError(
      'NO_DIMENSIONS',
      'At least one dimension must have a winner.',
      400,
    )
  }

  // Both trajectories must belong to the claimed workspace.
  const trajRows = await db
    .select({
      id: trajectories.id,
      workspaceId: trajectories.workspaceId,
    })
    .from(trajectories)
    .where(eq(trajectories.workspaceId, parsed.workspaceId))
  const ids = new Set(trajRows.map((r) => r.id))
  if (!ids.has(parsed.trajectoryAId)) {
    throw new NotFoundError('Trajectory A')
  }
  if (!ids.has(parsed.trajectoryBId)) {
    throw new NotFoundError('Trajectory B')
  }

  const [evt] = await db
    .insert(events)
    .values({
      type: 'comparison.submitted',
      workspaceId: parsed.workspaceId,
      actorId: user.id,
      payload: {
        trajectoryAId: parsed.trajectoryAId,
        trajectoryBId: parsed.trajectoryBId,
        winners: parsed.winners,
        reason: parsed.reason ?? null,
      },
    })
    .returning({ id: events.id })

  try {
    revalidatePath(
      `/workspaces/${parsed.workspaceId}/trajectories/${parsed.trajectoryAId}/annotate`,
    )
  } catch {
    /* outside request context */
  }

  return {
    ok: true,
    eventId: evt.id,
    workspaceId: parsed.workspaceId,
  }
}
