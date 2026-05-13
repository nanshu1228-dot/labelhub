'use server'

/**
 * Annotation Mark — read + write Server Actions for the trajectory annotator.
 *
 * Built specifically for the new `<TrajectoryAnnotator>` shell. Differs from
 * `step-annotations-demo.ts` in two ways:
 *
 *   1. Multi-rubric per step. The existing reader returns `Record<stepId,
 *      oneRow>` (one mark per step) which fits the old single-likert UI.
 *      The new annotator has 1-4 rubrics per step; we need
 *      `Record<stepId, Record<rubricId, Mark>>`.
 *
 *   2. Canonical Mark storage. The existing schema stores `rating` (int)
 *      + `reasoning` (text). We extend this by writing the discriminated
 *      `Mark` union to the `altSuggestion` jsonb column. Reading prefers
 *      `altSuggestion`, falls back to `rating + reasoning` for legacy rows.
 *      No schema migration needed.
 *
 * Demo-mode-gated like its sibling, because real Supabase Auth wiring is
 * still pending. When we cut to real users, this file's auth checks change;
 * everything else (the canonical Mark storage shape) stays.
 */

import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  stepAnnotations,
  trajectories,
  trajectorySteps,
} from '@/lib/db/schema'
import {
  AppError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { openTrajectoryForAnnotation } from './inbox'

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001'

function assertDemoMode(): void {
  if (process.env.LABELHUB_DEMO_MODE !== 'true') {
    throw new AppError(
      'DEMO_MODE_DISABLED',
      'Demo annotation is disabled. Set LABELHUB_DEMO_MODE=true in .env.local to enable.',
      403,
    )
  }
}

// ─── Mark contract ────────────────────────────────────────────────────────

/**
 * Discriminated-union Mark — same shape as `Mark` in
 * src/lib/templates/rubric.ts, validated at the network boundary here
 * because Server Actions are an untrusted edge.
 */
const markSchema = z.discriminatedUnion('scale', [
  z.object({
    scale: z.literal('likert'),
    value: z.union([z.literal(1), z.literal(3), z.literal(5)]),
    reason: z.string().max(4000).optional(),
  }),
  z.object({
    scale: z.literal('bool'),
    value: z.boolean(),
    reason: z.string().max(4000).optional(),
  }),
  z.object({
    scale: z.literal('enum'),
    value: z.string().min(1).max(64),
    reason: z.string().max(4000).optional(),
  }),
  z.object({
    scale: z.literal('text'),
    value: z.string().max(8000),
  }),
])

type MarkLike = z.infer<typeof markSchema>

// ─── Step-mark write ──────────────────────────────────────────────────────

const commitStepMarkSchema = z.object({
  workspaceId: uuidLike,
  trajectoryStepId: uuidLike,
  rubricId: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  mark: markSchema,
})

export type CommitStepMarkInput = z.infer<typeof commitStepMarkSchema>

/**
 * Upsert one rubric's mark on one step. Unique key is
 * (annotation, trajectoryStepId, kind=rubricId).
 *
 * Storage:
 *   - `kind`         = rubricId
 *   - `rating`       = mark.value when scale=likert (else null)
 *   - `reasoning`    = mark.reason ?? '' (NOT NULL on the column; empty allowed)
 *   - `altSuggestion`= the full Mark object (canonical, covers all scales)
 *
 * Why we still write rating/reasoning when scale=likert: keeps the existing
 * IAA query (which reads `rating`) working without changes. New IAA paths
 * should switch to reading `altSuggestion` for scale-aware aggregation.
 */
export async function commitStepMark(input: CommitStepMarkInput) {
  assertDemoMode()
  const parsed = commitStepMarkSchema.parse(input)
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
    userId: DEMO_USER_ID,
  })

  const mark = parsed.mark
  const rating = mark.scale === 'likert' ? mark.value : null
  const reasoning =
    mark.scale === 'text'
      ? mark.value
      : (mark.reason ?? '')

  const [existing] = await db
    .select()
    .from(stepAnnotations)
    .where(
      and(
        eq(stepAnnotations.annotationId, binding.annotationId),
        eq(stepAnnotations.trajectoryStepId, parsed.trajectoryStepId),
        eq(stepAnnotations.kind, parsed.rubricId),
      ),
    )
    .limit(1)

  let row: typeof stepAnnotations.$inferSelect
  if (existing) {
    const [updated] = await db
      .update(stepAnnotations)
      .set({
        rating,
        reasoning,
        altSuggestion: mark,
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
        kind: parsed.rubricId,
        rating,
        reasoning,
        altSuggestion: mark,
      })
      .returning()
    row = created
  }

  await db.insert(events).values({
    type: existing ? 'step_mark.updated' : 'step_mark.created',
    workspaceId: parsed.workspaceId,
    actorId: DEMO_USER_ID,
    payload: {
      stepAnnotationId: row.id,
      annotationId: binding.annotationId,
      trajectoryStepId: parsed.trajectoryStepId,
      rubricId: parsed.rubricId,
      mark,
      demo: true,
    },
  })

  // Bust caches lazily — the annotator does optimistic UI so we don't need
  // a synchronous re-fetch, but downstream surfaces (trajectory list,
  // dashboard tile counts) should see the new state.
  try {
    revalidatePath(
      `/workspaces/${parsed.workspaceId}/trajectories/${step.trajectoryId}/annotate`,
    )
    revalidatePath(
      `/workspaces/${parsed.workspaceId}/trajectories/${step.trajectoryId}`,
    )
    revalidatePath(`/workspaces/${parsed.workspaceId}/trajectories`)
    revalidatePath(`/workspaces/${parsed.workspaceId}`)
  } catch {
    // Outside a request context (e.g. scripts) revalidatePath throws.
    // The DB write succeeded; UI will catch up on next navigation.
  }

  return { ok: true as const, row }
}

// ─── Trajectory-level mark write ──────────────────────────────────────────

const commitTrajectoryMarkSchema = z.object({
  workspaceId: uuidLike,
  trajectoryId: uuidLike,
  rubricId: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  mark: markSchema,
})

export type CommitTrajectoryMarkInput = z.infer<
  typeof commitTrajectoryMarkSchema
>

/**
 * Write a per-trajectory rubric answer.
 *
 * Storage lives in `annotations.payload` (jsonb), merged by rubricId.
 * The annotations row is the existing one bound to this user + trajectory's
 * inbox topic — same find-or-create chain as step marks.
 */
export async function commitTrajectoryMark(input: CommitTrajectoryMarkInput) {
  assertDemoMode()
  const parsed = commitTrajectoryMarkSchema.parse(input)
  const db = getDb()

  // Verify trajectory ↔ workspace.
  const [traj] = await db
    .select({
      id: trajectories.id,
      workspaceId: trajectories.workspaceId,
    })
    .from(trajectories)
    .where(eq(trajectories.id, parsed.trajectoryId))
    .limit(1)
  if (!traj) throw new NotFoundError('Trajectory')
  if (traj.workspaceId !== parsed.workspaceId) {
    throw new ForbiddenError("Trajectory is not in the claimed workspace.")
  }

  const binding = await openTrajectoryForAnnotation({
    workspaceId: parsed.workspaceId,
    trajectoryId: parsed.trajectoryId,
    userId: DEMO_USER_ID,
  })

  // Merge into annotations.payload {rubricId → Mark}.
  const [ann] = await db
    .select({ id: annotations.id, payload: annotations.payload })
    .from(annotations)
    .where(eq(annotations.id, binding.annotationId))
    .limit(1)
  if (!ann) throw new NotFoundError('Annotation row')

  const prev = (ann.payload ?? {}) as Record<string, unknown>
  const next = { ...prev, [parsed.rubricId]: parsed.mark }

  await db
    .update(annotations)
    .set({ payload: next })
    .where(eq(annotations.id, ann.id))

  await db.insert(events).values({
    type: 'trajectory_mark.updated',
    workspaceId: parsed.workspaceId,
    actorId: DEMO_USER_ID,
    payload: {
      annotationId: ann.id,
      trajectoryId: parsed.trajectoryId,
      rubricId: parsed.rubricId,
      mark: parsed.mark,
      demo: true,
    },
  })

  try {
    revalidatePath(
      `/workspaces/${parsed.workspaceId}/trajectories/${parsed.trajectoryId}/annotate`,
    )
    revalidatePath(`/workspaces/${parsed.workspaceId}`)
  } catch {
    /* outside request context */
  }

  return { ok: true as const, annotationId: ann.id }
}

// ─── Read API ─────────────────────────────────────────────────────────────

/**
 * Read the demo user's marks for one trajectory.
 *
 * Returns:
 *   stepMarks       — { stepId: { rubricId: Mark } }
 *   trajectoryMarks — { rubricId: Mark }
 *
 * Decoding precedence per row:
 *   - If `altSuggestion` looks like a Mark (has `scale`), trust it as-is.
 *   - Else if `rating` is set, synthesize a likert Mark from `rating` + `reasoning`.
 *   - Else skip (row exists but has no value yet).
 */
export interface AnnotatorMarks {
  stepMarks: Record<string, Record<string, MarkLike>>
  trajectoryMarks: Record<string, MarkLike>
}

export async function readMyAnnotatorMarks(opts: {
  workspaceId: string
  trajectoryId: string
}): Promise<AnnotatorMarks> {
  const db = getDb()

  // Trajectory ↔ workspace check (silently empty on mismatch — readers
  // shouldn't leak the existence of a mis-scoped trajectory).
  const [traj] = await db
    .select({ id: trajectories.id, workspaceId: trajectories.workspaceId })
    .from(trajectories)
    .where(eq(trajectories.id, opts.trajectoryId))
    .limit(1)
  if (!traj || traj.workspaceId !== opts.workspaceId) {
    return { stepMarks: {}, trajectoryMarks: {} }
  }

  // The demo user might have multiple annotation rows across topics. We need
  // the one bound to THIS trajectory's inbox topic — find via the binding
  // chain (cheap: small fan-out).
  const myAnns = await db
    .select({ id: annotations.id, payload: annotations.payload })
    .from(annotations)
    .where(eq(annotations.userId, DEMO_USER_ID))
  if (myAnns.length === 0) return { stepMarks: {}, trajectoryMarks: {} }
  const annIds = myAnns.map((a) => a.id)

  // Steps in this trajectory.
  const stepRows = await db
    .select({ id: trajectorySteps.id })
    .from(trajectorySteps)
    .where(eq(trajectorySteps.trajectoryId, opts.trajectoryId))
  if (stepRows.length === 0) return { stepMarks: {}, trajectoryMarks: {} }
  const stepIds = stepRows.map((s) => s.id)

  // Pull every step_annotation matching our annotations + these step ids.
  const rows = await db
    .select()
    .from(stepAnnotations)
    .where(
      and(
        inArray(stepAnnotations.annotationId, annIds),
        inArray(stepAnnotations.trajectoryStepId, stepIds),
      ),
    )

  const stepMarks: Record<string, Record<string, MarkLike>> = {}
  let activeAnnIdForTraj: string | null = null
  for (const r of rows) {
    const mark = decodeMark(r.altSuggestion, r.rating, r.reasoning)
    if (!mark) continue
    const bucket = stepMarks[r.trajectoryStepId] ?? {}
    bucket[r.kind] = mark
    stepMarks[r.trajectoryStepId] = bucket
    // Whichever annotation row has step marks attached IS the active one.
    activeAnnIdForTraj = r.annotationId
  }

  // Trajectory-level marks live on annotations.payload of the active row.
  let trajectoryMarks: Record<string, MarkLike> = {}
  if (activeAnnIdForTraj) {
    const active = myAnns.find((a) => a.id === activeAnnIdForTraj)
    if (active && active.payload && typeof active.payload === 'object') {
      const payload = active.payload as Record<string, unknown>
      for (const [k, v] of Object.entries(payload)) {
        if (v && typeof v === 'object' && 'scale' in (v as object)) {
          trajectoryMarks[k] = v as MarkLike
        }
      }
    }
  }

  return { stepMarks, trajectoryMarks }
}

function decodeMark(
  altSuggestion: unknown,
  rating: number | null,
  reasoning: string | null,
): MarkLike | null {
  if (altSuggestion && typeof altSuggestion === 'object') {
    const o = altSuggestion as Record<string, unknown>
    if (
      o.scale === 'likert' ||
      o.scale === 'bool' ||
      o.scale === 'enum' ||
      o.scale === 'text'
    ) {
      return o as MarkLike
    }
  }
  if (rating === 1 || rating === 3 || rating === 5) {
    return {
      scale: 'likert',
      value: rating,
      reason: reasoning ?? undefined,
    }
  }
  return null
}
