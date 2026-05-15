'use server'

/**
 * Inline step-annotation Server Action — powers the small "rate this
 * step" widget on the trajectory detail page.
 *
 * Distinct from `addStepAnnotation` (in `step-annotations.ts`) which is
 * the heavier workflow-aware path used by the full annotator. This one
 * is the lighter inline upsert path: one rating button click → one
 * step_annotation row, auto-binding into the workspace inbox topic on
 * first touch.
 *
 * Auth: every export calls `requireWorkspaceMember(workspaceId)` and
 * blocks viewers from writes. Reads return empty for unauth callers so
 * the trajectory detail page still renders for read-only browse.
 *
 * History note (deleted in commit after 5a2ec01): this file was named
 * `step-annotations-demo.ts` and used a hardcoded `DEMO_USER_ID` as
 * the actor, gated only on `LABELHUB_DEMO_MODE=true`. Both gone now —
 * real auth across the board.
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

export type MarkStepInlineInput = z.infer<typeof markSchema>

/**
 * Upsert one step annotation. Used by the inline rating widget on the
 * trajectory detail page.
 *
 * Semantics: one annotation per (annotationId, trajectoryStepId, kind).
 * Calling this twice with the same triple UPDATES the existing row rather
 * than creating a second mark — UI can re-save freely on rating change.
 */
export async function markStepInline(input: MarkStepInlineInput) {
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
export async function listMyStepMarksInline(opts: {
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
