'use server'

/**
 * Gold-standard Server Actions.
 *
 * Two operations:
 *
 *   1. promoteAnnotationToGold — admin freezes their own annotation as the
 *      reference answer for a trajectory. Snapshots trajectory marks AND
 *      step marks at the time of promotion. Idempotent: a second promote
 *      OVERWRITES the existing gold (admins refine the criteria over time).
 *
 *   2. unmarkGold — admin removes a gold. Emits a delete event so the
 *      audit log can show "this used to be a gold but admin retracted it".
 *
 * Both are admin-only. The signal feeds the calibration scores shown to
 * admins on the members and trust surfaces.
 */

import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  goldStandards,
  stepAnnotations,
  topics,
  trajectories,
  trajectorySteps,
} from '@/lib/db/schema'
import { AppError, NotFoundError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import type { Mark } from '@/lib/templates/rubric'
import type {
  GoldCorrectAnswer,
  GoldItemData,
} from '@/lib/queries/gold-standards'

// ─── Promote ─────────────────────────────────────────────────────────────

const promoteSchema = z.object({
  workspaceId: uuidLike,
  trajectoryId: uuidLike,
  /** Optional rationale shown on the gold-standards page. */
  explanation: z.string().max(2000).optional(),
})

export interface PromoteResult {
  ok: true
  goldId: string
  /** True when the gold was created; false when an existing one was updated. */
  created: boolean
  trajectoryMarkCount: number
  stepMarkCount: number
}

export async function promoteAnnotationToGold(
  input: z.infer<typeof promoteSchema>,
): Promise<PromoteResult> {
  const parsed = promoteSchema.parse(input)
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)
  const db = getDb()

  // Resolve trajectory → workspace boundary check.
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
    throw new AppError(
      'WORKSPACE_MISMATCH',
      'Trajectory is not in the claimed workspace.',
      400,
    )
  }

  // Find the admin's own annotation row for this trajectory.
  //
  // The trajectory → topic mapping isn't 1:1 (a trajectory can appear under
  // multiple topics if the workspace re-batches). We look for an annotation
  // that has the admin's marks attached AND belongs to a topic whose task
  // is in this workspace.
  //
  // Approach: pull step_annotations matching (userId=admin) whose step
  // belongs to this trajectory, then group by annotation_id and pick the
  // row with the most step marks (defends against stale partial rows).
  const steps = await db
    .select({ id: trajectorySteps.id })
    .from(trajectorySteps)
    .where(eq(trajectorySteps.trajectoryId, parsed.trajectoryId))
  const stepIds = steps.map((s) => s.id)
  if (stepIds.length === 0) {
    throw new AppError(
      'EMPTY_TRAJECTORY',
      'Trajectory has no steps — cannot promote.',
      400,
    )
  }

  // All step annotations for this trajectory by this admin.
  const myStepMarks = await db
    .select({
      annotationId: stepAnnotations.annotationId,
      trajectoryStepId: stepAnnotations.trajectoryStepId,
      rubricId: stepAnnotations.kind,
      payload: stepAnnotations.payload,
      annotationUserId: annotations.userId,
    })
    .from(stepAnnotations)
    .innerJoin(annotations, eq(annotations.id, stepAnnotations.annotationId))
    .where(
      and(
        eq(annotations.userId, user.id),
        inArray(stepAnnotations.trajectoryStepId, stepIds),
      ),
    )

  if (myStepMarks.length === 0) {
    throw new AppError(
      'NO_ANNOTATION',
      'You haven\'t annotated this trajectory yet — annotate it first, then promote.',
      400,
    )
  }

  // Pick the annotation row that has the MOST marks on this trajectory.
  const annotationCounts = new Map<string, number>()
  for (const m of myStepMarks) {
    annotationCounts.set(
      m.annotationId,
      (annotationCounts.get(m.annotationId) ?? 0) + 1,
    )
  }
  let bestAnnotationId = ''
  let bestCount = -1
  for (const [id, count] of annotationCounts) {
    if (count > bestCount) {
      bestCount = count
      bestAnnotationId = id
    }
  }

  // Build step marks snapshot.
  const stepMarksSnapshot: Record<string, Record<string, Mark>> = {}
  for (const m of myStepMarks) {
    if (m.annotationId !== bestAnnotationId) continue
    const mark = (m.payload ?? null) as Mark | null
    if (!mark || !('scale' in mark)) continue
    const bucket = stepMarksSnapshot[m.trajectoryStepId] ?? {}
    bucket[m.rubricId] = mark
    stepMarksSnapshot[m.trajectoryStepId] = bucket
  }

  // Trajectory-level marks from the chosen annotation row's payload.
  const [annRow] = await db
    .select({
      id: annotations.id,
      topicId: annotations.topicId,
      payload: annotations.payload,
    })
    .from(annotations)
    .where(eq(annotations.id, bestAnnotationId))
    .limit(1)
  if (!annRow) {
    throw new AppError(
      'ANNOTATION_GONE',
      'Annotation disappeared mid-promote. Try again.',
      500,
    )
  }
  const trajectoryMarksSnapshot: Record<string, Mark> = {}
  const annPayload = (annRow.payload ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(annPayload)) {
    if (v && typeof v === 'object' && 'scale' in (v as object)) {
      trajectoryMarksSnapshot[k] = v as Mark
    }
  }

  const stepMarkCount = Object.values(stepMarksSnapshot).reduce(
    (acc, m) => acc + Object.keys(m).length,
    0,
  )
  const trajectoryMarkCount = Object.keys(trajectoryMarksSnapshot).length
  if (stepMarkCount + trajectoryMarkCount === 0) {
    throw new AppError(
      'EMPTY_ANNOTATION',
      'Your annotation has no marks on it yet — nothing to promote.',
      400,
    )
  }

  // Resolve the task id (gold rows are keyed on tasks).
  const [topicRow] = await db
    .select({ taskId: topics.taskId })
    .from(topics)
    .where(eq(topics.id, annRow.topicId))
    .limit(1)
  if (!topicRow) throw new NotFoundError('Topic for annotation')

  const itemData: GoldItemData = {
    kind: 'trajectory',
    workspaceId: parsed.workspaceId,
    trajectoryId: parsed.trajectoryId,
    sourceAnnotationId: bestAnnotationId,
    promotedByUserId: user.id,
    promotedAt: new Date().toISOString(),
  }
  const correctAnswer: GoldCorrectAnswer = {
    trajectoryMarks: trajectoryMarksSnapshot,
    stepMarks: stepMarksSnapshot,
  }

  // Upsert by (taskId, trajectoryId). We pull existing first since the
  // gold_standards table doesn't have a unique constraint on the JSON path.
  // Cheap enough — gold rows scale with the number of admin-curated
  // trajectories, not annotators.
  const existing = await db
    .select({ id: goldStandards.id, itemData: goldStandards.itemData })
    .from(goldStandards)
    .where(eq(goldStandards.taskId, topicRow.taskId))
  const existingForThisTraj = existing.find((r) => {
    const d = r.itemData as GoldItemData | null
    return d && d.kind === 'trajectory' && d.trajectoryId === parsed.trajectoryId
  })

  let goldId: string
  let created: boolean
  if (existingForThisTraj) {
    await db
      .update(goldStandards)
      .set({
        itemData,
        correctAnswer,
        explanation: parsed.explanation ?? null,
      })
      .where(eq(goldStandards.id, existingForThisTraj.id))
    goldId = existingForThisTraj.id
    created = false
  } else {
    const [inserted] = await db
      .insert(goldStandards)
      .values({
        taskId: topicRow.taskId,
        itemData,
        correctAnswer,
        explanation: parsed.explanation ?? null,
      })
      .returning({ id: goldStandards.id })
    goldId = inserted.id
    created = true
  }

  await db.insert(events).values({
    type: created ? 'gold.promoted' : 'gold.updated',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: {
      goldId,
      trajectoryId: parsed.trajectoryId,
      sourceAnnotationId: bestAnnotationId,
      trajectoryMarkCount,
      stepMarkCount,
    },
  })

  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}`)
    revalidatePath(
      `/workspaces/${parsed.workspaceId}/trajectories/${parsed.trajectoryId}`,
    )
    revalidatePath(`/workspaces/${parsed.workspaceId}/members`)
    revalidatePath(`/workspaces/${parsed.workspaceId}/disputes`)
  } catch {
    /* outside request context */
  }

  return {
    ok: true,
    goldId,
    created,
    trajectoryMarkCount,
    stepMarkCount,
  }
}

// ─── Unmark ──────────────────────────────────────────────────────────────

const unmarkSchema = z.object({
  workspaceId: uuidLike,
  goldId: uuidLike,
})

export async function unmarkGold(
  input: z.infer<typeof unmarkSchema>,
): Promise<{ ok: true }> {
  const parsed = unmarkSchema.parse(input)
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)
  const db = getDb()

  const [row] = await db
    .select({
      id: goldStandards.id,
      itemData: goldStandards.itemData,
    })
    .from(goldStandards)
    .where(eq(goldStandards.id, parsed.goldId))
    .limit(1)
  if (!row) throw new NotFoundError('Gold standard')
  const item = row.itemData as GoldItemData | null
  if (!item || item.kind !== 'trajectory' || item.workspaceId !== parsed.workspaceId) {
    throw new AppError(
      'WORKSPACE_MISMATCH',
      'Gold standard does not belong to this workspace.',
      400,
    )
  }

  await db.delete(goldStandards).where(eq(goldStandards.id, parsed.goldId))

  await db.insert(events).values({
    type: 'gold.removed',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: {
      goldId: parsed.goldId,
      trajectoryId: item.trajectoryId,
    },
  })

  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}`)
    revalidatePath(
      `/workspaces/${parsed.workspaceId}/trajectories/${item.trajectoryId}`,
    )
    revalidatePath(`/workspaces/${parsed.workspaceId}/members`)
    revalidatePath(`/workspaces/${parsed.workspaceId}/disputes`)
  } catch {
    /* outside request context */
  }

  return { ok: true }
}
