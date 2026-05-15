'use server'

/**
 * Demo-mode step annotation Server Action.
 *
 * Why a separate action: the production `addStepAnnotation` requires a real
 * Supabase user session (`requireUser()`). Proxy-captured trajectories that
 * an evaluator wants to demo through are not behind that session — they only
 * carry a workspace API key + the captured data. Adding a real auth flow is
 * its own thing.
 *
 * For the competition demo we want: open a trajectory detail page, click a
 * rating button, see the mark land in DB. To make that work without burning
 * a day on Supabase Auth wiring, we provide this side-door:
 *
 *   - Only callable when `LABELHUB_DEMO_MODE=true` (defaults FALSE in prod)
 *   - Always acts as the seeded demo admin user (id …001)
 *   - Auto-binds the trajectory into the workspace Inbox task on first call
 *   - Inserts into `step_annotations` exactly as the prod path would
 *
 * Production code paths are untouched. The day we wire Supabase Auth, this
 * file can be deleted and the prod `addStepAnnotation` becomes canonical.
 */

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  stepAnnotations,
  trajectories,
  trajectorySteps,
} from '@/lib/db/schema'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import {
  optionalUser,
  requireWorkspaceMember,
} from '@/lib/auth/guards'
import { openTrajectoryForAnnotation } from './inbox'

/**
 * SECURITY note: this file used to gate on LABELHUB_DEMO_MODE + a
 * hardcoded DEMO_USER_ID literal — anyone in demo mode could
 * impersonate the seed admin. Both have been removed; every export now
 * resolves the real signed-in user via the standard auth guards.
 *
 * The "-demo" suffix on the file name is historical; kept to avoid
 * breaking imports elsewhere in the tree. The behavior is real auth.
 */

// ───────────────────────────────────────────────────────────────────────
// Add / upsert
// ───────────────────────────────────────────────────────────────────────

const markSchema = z.object({
  workspaceId: z.string().uuid(),
  trajectoryStepId: z.string().uuid(),
  /** Discriminates kinds like 'step_quality', 'tool_correctness'. MVP: step_quality. */
  kind: z.string().min(1).max(64).default('step_quality'),
  /** 1-5 Likert. For step_quality we map: 1=wrong, 3=suspicious, 5=correct. */
  rating: z.number().int().min(1).max(5),
  reasoning: z.string().min(1).max(4000),
})

export type MarkStepDemoInput = z.infer<typeof markSchema>

/**
 * Upsert a step annotation in demo mode.
 *
 * Semantics: one annotation per (annotationId, trajectoryStepId, kind).
 * Calling this twice with the same triple UPDATES the existing row rather
 * than creating a second mark — UI can re-save freely on rating change.
 */
export async function markStepDemo(input: MarkStepDemoInput) {
  const parsed = markSchema.parse(input)
  // Real auth: must be a workspace member; viewers can't write marks.
  const { user, role } = await requireWorkspaceMember(parsed.workspaceId)
  if (role === 'viewer') {
    throw new ForbiddenError(
      'Viewers cannot submit step marks. Ask an admin to upgrade your role.',
    )
  }
  const db = getDb()

  // Resolve trajectory + verify it belongs to the claimed workspace.
  const [step] = await db
    .select({
      id: trajectorySteps.id,
      trajectoryId: trajectorySteps.trajectoryId,
    })
    .from(trajectorySteps)
    .where(eq(trajectorySteps.id, parsed.trajectoryStepId))
    .limit(1)
  if (!step) throw new NotFoundError('Trajectory step')

  const [traj] = await db
    .select({
      id: trajectories.id,
      workspaceId: trajectories.workspaceId,
    })
    .from(trajectories)
    .where(eq(trajectories.id, step.trajectoryId))
    .limit(1)
  if (!traj) throw new NotFoundError('Trajectory')
  if (traj.workspaceId !== parsed.workspaceId) {
    throw new ForbiddenError(
      "Step's trajectory is not in the claimed workspace.",
    )
  }

  // Find-or-create the annotation chain (inbox task → topic → my annotation).
  const binding = await openTrajectoryForAnnotation({
    workspaceId: parsed.workspaceId,
    trajectoryId: step.trajectoryId,
    userId: user.id,
  })

  // Upsert by (annotation, step, kind).
  const [existing] = await db
    .select()
    .from(stepAnnotations)
    .where(
      and(
        eq(stepAnnotations.annotationId, binding.annotationId),
        eq(stepAnnotations.trajectoryStepId, parsed.trajectoryStepId),
        eq(stepAnnotations.kind, parsed.kind),
      ),
    )
    .limit(1)

  let row: typeof stepAnnotations.$inferSelect
  if (existing) {
    const [updated] = await db
      .update(stepAnnotations)
      .set({
        rating: parsed.rating,
        reasoning: parsed.reasoning,
      })
      .where(eq(stepAnnotations.id, existing.id))
      .returning()
    row = updated
  } else {
    const [created] = await db
      .insert(stepAnnotations)
      .values({
        annotationId: binding.annotationId,
        trajectoryStepId: parsed.trajectoryStepId,
        kind: parsed.kind,
        rating: parsed.rating,
        reasoning: parsed.reasoning,
      })
      .returning()
    row = created
  }

  await db.insert(events).values({
    type: existing ? 'step_annotation.updated' : 'step_annotation.created',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: {
      stepAnnotationId: row.id,
      annotationId: binding.annotationId,
      trajectoryStepId: parsed.trajectoryStepId,
      kind: parsed.kind,
      rating: parsed.rating,
      demo: true,
    },
  })

  // Bust caches for the surfaces whose displayed counts depend on this row:
  //   - the trajectory detail page (existing mark hydration)
  //   - the trajectories list page (per-row coverage badge)
  //   - the workspace dashboard (ANNOTATED tile)
  // Best-effort; if the API ever changes we don't want this to break the write.
  try {
    revalidatePath(
      `/workspaces/${parsed.workspaceId}/trajectories/${step.trajectoryId}`,
    )
    revalidatePath(`/workspaces/${parsed.workspaceId}/trajectories`)
    revalidatePath(`/workspaces/${parsed.workspaceId}`)
  } catch {
    // Outside of a request context (e.g. invoked from a script), revalidatePath
    // throws; swallow because the DB write already succeeded.
  }

  return {
    stepAnnotation: row,
    binding,
  }
}

// ───────────────────────────────────────────────────────────────────────
// Read: my marks for one trajectory's steps
// ───────────────────────────────────────────────────────────────────────

/**
 * Fetch the demo user's existing step marks for a trajectory.
 * Returns a map of trajectoryStepId → step_annotation row.
 *
 * Idempotent + safe to call before any mark exists (returns empty map).
 */
export async function listMyStepAnnotationsDemo(opts: {
  workspaceId: string
  trajectoryId: string
}): Promise<Record<string, typeof stepAnnotations.$inferSelect>> {
  // Unauth callers get empty — read-only browse path on the trajectory
  // detail page still renders, just with no "my marks" hydration. Auth'd
  // callers must be members of this workspace (no cross-tenant snooping
  // via the trajectoryId).
  const me = await optionalUser()
  if (!me) return {}
  try {
    await requireWorkspaceMember(opts.workspaceId)
  } catch {
    return {}
  }
  const db = getDb()

  // Verify trajectory belongs to the workspace before exposing marks.
  const [traj] = await db
    .select({ id: trajectories.id, workspaceId: trajectories.workspaceId })
    .from(trajectories)
    .where(eq(trajectories.id, opts.trajectoryId))
    .limit(1)
  if (!traj || traj.workspaceId !== opts.workspaceId) return {}

  // Find THIS user's annotation rows (if any). If none, no marks to show.
  const allTopics = await db
    .select()
    .from(annotations)
    .where(eq(annotations.userId, me.id))
  if (allTopics.length === 0) return {}

  // Find the step annotations that belong to ANY of the demo user's
  // annotations AND ANY of the trajectory's steps.
  const steps = await db
    .select({ id: trajectorySteps.id })
    .from(trajectorySteps)
    .where(eq(trajectorySteps.trajectoryId, opts.trajectoryId))
  const stepIds = new Set(steps.map((s) => s.id))
  const annIds = allTopics.map((a) => a.id)

  const allMarks = await db
    .select()
    .from(stepAnnotations)
  // Filter in-memory — small set per trajectory.
  const out: Record<string, typeof stepAnnotations.$inferSelect> = {}
  for (const m of allMarks) {
    if (!annIds.includes(m.annotationId)) continue
    if (!stepIds.has(m.trajectoryStepId)) continue
    out[m.trajectoryStepId] = m
  }
  return out
}

// (No `validateMarkInput` export — `'use server'` modules can only export
// async functions. Callers that need preflight should mirror the simple
// shape: `{ workspaceId, trajectoryStepId, rating, reasoning }`.)
