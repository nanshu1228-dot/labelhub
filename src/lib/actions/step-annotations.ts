'use server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  stepAnnotations,
  tasks,
  topics,
  trajectorySteps,
} from '@/lib/db/schema'
import { requireUser } from '@/lib/auth/guards'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors'

/**
 * Step annotation CRUD — the per-step marks that make trajectory eval work.
 *
 * Authorization:
 *   - Only the topic's annotation owner can add/remove their step marks
 *   - Only while topic.status ∈ {drafting, revising}
 *   - Step must belong to the trajectory bound to this topic (anti-spoof)
 */

const addSchema = z.object({
  annotationId: z.string().uuid(),
  trajectoryStepId: z.string().uuid(),
  /** Template-defined: e.g. 'step_quality', 'tool_correctness', 'reasoning_quality' */
  kind: z.string().min(1).max(64),
  /** 1-5 Likert, nullable for boolean/categorical kinds */
  rating: z.number().int().min(1).max(5).nullable().optional(),
  reasoning: z.string().min(1).max(4000),
  /** Canonical Mark JSON (or any structured override). Renamed from
   *  `altSuggestion` on 2026-05-14 to reflect what it actually stores. */
  payload: z.record(z.string(), z.unknown()).optional(),
})

export type AddStepAnnotationInput = z.infer<typeof addSchema>

export async function addStepAnnotation(input: AddStepAnnotationInput) {
  const parsed = addSchema.parse(input)
  const user = await requireUser()
  const db = getDb()

  // Auth chain: annotation → topic → task → workspace
  const [annotation] = await db
    .select()
    .from(annotations)
    .where(eq(annotations.id, parsed.annotationId))
    .limit(1)
  if (!annotation) throw new NotFoundError('Annotation')
  if (annotation.userId !== user.id) {
    throw new ForbiddenError('Not your annotation.')
  }

  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, annotation.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')
  if (topic.status !== 'drafting' && topic.status !== 'revising') {
    throw new ConflictError(
      `Topic is ${topic.status} — step marks frozen.`,
    )
  }

  // Anti-spoof: step must belong to the topic's bound trajectory
  const [step] = await db
    .select()
    .from(trajectorySteps)
    .where(eq(trajectorySteps.id, parsed.trajectoryStepId))
    .limit(1)
  if (!step) throw new NotFoundError('Trajectory step')

  const itemData = topic.itemData as { trajectoryId?: string }
  if (!itemData.trajectoryId || step.trajectoryId !== itemData.trajectoryId) {
    throw new ValidationError(
      "Step does not belong to this topic's trajectory.",
    )
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const [row] = await db
    .insert(stepAnnotations)
    .values({
      annotationId: parsed.annotationId,
      trajectoryStepId: parsed.trajectoryStepId,
      kind: parsed.kind,
      rating: parsed.rating ?? null,
      reasoning: parsed.reasoning,
      payload: parsed.payload ?? null,
    })
    .returning()

  await db.insert(events).values({
    type: 'step_annotation.created',
    workspaceId: task.workspaceId,
    actorId: user.id,
    payload: {
      stepAnnotationId: row.id,
      annotationId: annotation.id,
      trajectoryStepId: parsed.trajectoryStepId,
      taskId: task.id,
      kind: parsed.kind,
      rating: parsed.rating ?? null,
    },
  })

  return row
}

const removeSchema = z.object({ stepAnnotationId: z.string().uuid() })

export async function removeStepAnnotation(
  input: z.infer<typeof removeSchema>,
) {
  const parsed = removeSchema.parse(input)
  const user = await requireUser()
  const db = getDb()

  const [stepAnn] = await db
    .select()
    .from(stepAnnotations)
    .where(eq(stepAnnotations.id, parsed.stepAnnotationId))
    .limit(1)
  if (!stepAnn) throw new NotFoundError('Step annotation')

  const [annotation] = await db
    .select()
    .from(annotations)
    .where(eq(annotations.id, stepAnn.annotationId))
    .limit(1)
  if (!annotation) throw new NotFoundError('Annotation')
  if (annotation.userId !== user.id) {
    throw new ForbiddenError('Not your step annotation.')
  }

  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, annotation.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')
  if (topic.status !== 'drafting' && topic.status !== 'revising') {
    throw new ConflictError(`Topic is ${topic.status} — step marks frozen.`)
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)

  await db
    .delete(stepAnnotations)
    .where(eq(stepAnnotations.id, parsed.stepAnnotationId))

  if (task) {
    await db.insert(events).values({
      type: 'step_annotation.deleted',
      workspaceId: task.workspaceId,
      actorId: user.id,
      payload: {
        stepAnnotationId: parsed.stepAnnotationId,
        annotationId: annotation.id,
      },
    })
  }

  return { ok: true as const }
}

/**
 * Read-only: list a user's step annotations on a specific annotation row.
 * Cheap, no auth check (caller must already have access to the parent annotation).
 */
export async function listStepAnnotations(annotationId: string) {
  const db = getDb()
  return db
    .select()
    .from(stepAnnotations)
    .where(eq(stepAnnotations.annotationId, annotationId))
}
