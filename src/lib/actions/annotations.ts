'use server'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { tasks, topics, annotations, events } from '@/lib/db/schema'
import { requireUser, requireWorkspaceAdmin } from '@/lib/auth/guards'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors'
import { getTemplate } from '@/lib/templates/registry'
import '@/lib/templates/init'
import type { TemplateMode } from '@/lib/templates/types'

/**
 * Annotation Server Actions — the heart of the work loop.
 *
 * Authorization:
 *   - saveDraftAnnotation: only the topic's current claimer
 *   - submitAnnotation: only the topic's current claimer; strict schema validation
 *   - reviewAnnotation: workspace admin only
 *
 * Concurrency: topic.version optimistic locking on state transitions.
 */

const saveDraftSchema = z.object({
  topicId: z.string().uuid(),
  /** Validated against template.responseSchema only on submit, not draft */
  payload: z.record(z.string(), z.unknown()),
  claudeProposal: z.unknown().optional(),
  reasoningText: z.string().max(8000).optional(),
})

/**
 * Save (or update) a draft annotation. Idempotent — one row per (topic, user).
 * Drafts may be partial; full schema validation deferred to submitAnnotation.
 */
export async function saveDraftAnnotation(
  input: z.infer<typeof saveDraftSchema>,
) {
  const parsed = saveDraftSchema.parse(input)
  const user = await requireUser()
  const db = getDb()

  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, parsed.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')
  if (topic.assignedTo !== user.id) {
    throw new ForbiddenError('Not your topic.')
  }
  if (topic.status !== 'drafting' && topic.status !== 'revising') {
    throw new ConflictError(`Topic is ${topic.status} — drafting closed.`)
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const [existing] = await db
    .select()
    .from(annotations)
    .where(
      and(
        eq(annotations.topicId, parsed.topicId),
        eq(annotations.userId, user.id),
      ),
    )
    .limit(1)

  let annotation: typeof annotations.$inferSelect
  if (existing) {
    const [updated] = await db
      .update(annotations)
      .set({
        payload: parsed.payload,
        claudeProposal: parsed.claudeProposal ?? existing.claudeProposal,
        reasoningText: parsed.reasoningText ?? existing.reasoningText,
        version: existing.version + 1,
      })
      .where(eq(annotations.id, existing.id))
      .returning()
    annotation = updated
  } else {
    const [created] = await db
      .insert(annotations)
      .values({
        topicId: parsed.topicId,
        userId: user.id,
        payload: parsed.payload,
        claudeProposal: parsed.claudeProposal ?? null,
        reasoningText: parsed.reasoningText ?? null,
      })
      .returning()
    annotation = created
  }

  await db.insert(events).values({
    type: 'annotation.drafted',
    workspaceId: task.workspaceId,
    actorId: user.id,
    payload: { topicId: topic.id, annotationId: annotation.id },
  })

  return annotation
}

const submitSchema = z.object({
  topicId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
  claudeProposal: z.unknown().optional(),
  deltaSummary: z.string().max(2000).optional(),
  reasoningText: z.string().max(8000).optional(),
})

/**
 * Finalize an annotation. Validates payload against template.responseSchema.
 * Transitions topic: drafting/revising → submitted (optimistic lock).
 */
export async function submitAnnotation(input: z.infer<typeof submitSchema>) {
  const parsed = submitSchema.parse(input)
  const user = await requireUser()
  const db = getDb()

  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, parsed.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')
  if (topic.assignedTo !== user.id) {
    throw new ForbiddenError('Not your topic.')
  }
  if (topic.status !== 'drafting' && topic.status !== 'revising') {
    throw new ConflictError(`Topic is ${topic.status} — cannot submit.`)
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const template = getTemplate(task.templateMode as TemplateMode)
  if (!template) throw new ValidationError('Template not registered.')

  // STRICT validation against the template's responseSchema.
  // Throws ZodError with a clean message — wraps as ValidationError for the client.
  let validatedPayload: unknown
  try {
    validatedPayload = template.responseSchema.parse(parsed.payload)
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new ValidationError(
        e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      )
    }
    throw e
  }

  const [existing] = await db
    .select()
    .from(annotations)
    .where(
      and(
        eq(annotations.topicId, parsed.topicId),
        eq(annotations.userId, user.id),
      ),
    )
    .limit(1)

  const now = new Date()
  let annotation: typeof annotations.$inferSelect
  if (existing) {
    const [updated] = await db
      .update(annotations)
      .set({
        payload: validatedPayload,
        claudeProposal: parsed.claudeProposal ?? existing.claudeProposal,
        deltaSummary: parsed.deltaSummary ?? existing.deltaSummary,
        reasoningText: parsed.reasoningText ?? existing.reasoningText,
        submittedAt: now,
        version: existing.version + 1,
      })
      .where(eq(annotations.id, existing.id))
      .returning()
    annotation = updated
  } else {
    const [created] = await db
      .insert(annotations)
      .values({
        topicId: parsed.topicId,
        userId: user.id,
        payload: validatedPayload,
        claudeProposal: parsed.claudeProposal ?? null,
        deltaSummary: parsed.deltaSummary ?? null,
        reasoningText: parsed.reasoningText ?? null,
        submittedAt: now,
      })
      .returning()
    annotation = created
  }

  // Transition topic with optimistic lock — refuses if version changed mid-flight.
  const topicUpdate = await db
    .update(topics)
    .set({ status: 'submitted', version: topic.version + 1 })
    .where(and(eq(topics.id, topic.id), eq(topics.version, topic.version)))
    .returning()

  if (topicUpdate.length === 0) {
    throw new ConflictError(
      'Topic was modified concurrently — refresh and try again.',
    )
  }

  await db.insert(events).values({
    type: 'annotation.submitted',
    workspaceId: task.workspaceId,
    actorId: user.id,
    payload: {
      topicId: topic.id,
      annotationId: annotation.id,
      /** Mark whether this carries pair-annotation teaching signal */
      hasPairData: parsed.claudeProposal !== undefined,
    },
  })

  return annotation
}

const reviewSchema = z.object({
  annotationId: z.string().uuid(),
  decision: z.enum(['approve', 'reject', 'request_revision']),
  feedback: z.string().max(2000).optional(),
})

/**
 * Workspace admin reviews a submitted annotation.
 * Transitions topic: submitted → approved | rejected | revising.
 */
export async function reviewAnnotation(input: z.infer<typeof reviewSchema>) {
  const parsed = reviewSchema.parse(input)
  const db = getDb()

  const [annotation] = await db
    .select()
    .from(annotations)
    .where(eq(annotations.id, parsed.annotationId))
    .limit(1)
  if (!annotation) throw new NotFoundError('Annotation')

  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, annotation.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const { user } = await requireWorkspaceAdmin(task.workspaceId)

  if (topic.status !== 'submitted' && topic.status !== 'reviewing') {
    throw new ConflictError(`Topic is ${topic.status} — cannot review.`)
  }

  const transition: Record<typeof parsed.decision, {
    next: 'approved' | 'rejected' | 'revising'
    event: string
  }> = {
    approve: { next: 'approved', event: 'annotation.approved' },
    reject: { next: 'rejected', event: 'annotation.rejected' },
    request_revision: { next: 'revising', event: 'annotation.revised' },
  }
  const { next, event } = transition[parsed.decision]

  const updated = await db
    .update(topics)
    .set({ status: next, version: topic.version + 1 })
    .where(and(eq(topics.id, topic.id), eq(topics.version, topic.version)))
    .returning()

  if (updated.length === 0) {
    throw new ConflictError(
      'Topic was modified concurrently — refresh and try again.',
    )
  }

  await db.insert(events).values({
    type: event,
    workspaceId: task.workspaceId,
    actorId: user.id,
    payload: {
      topicId: topic.id,
      annotationId: annotation.id,
      /** Denormalized so TrustProjection can fold without DB joins. */
      submitterUserId: annotation.userId,
      decision: parsed.decision,
      feedback: parsed.feedback ?? null,
      /** Denormalized for downstream projections (Live Learning curve, IAA, etc.) */
      taskId: task.id,
      templateMode: task.templateMode,
      /** Snapshot of the annotation payload at review time — enables time-travel replays. */
      annotationPayload: annotation.payload,
    },
  })

  return { ok: true as const }
}

// ─── Review thread — submitter replies to a reviewer's feedback ───────────

const respondToReviewSchema = z.object({
  annotationId: z.string().uuid(),
  message: z.string().min(1).max(4000),
})

/**
 * The annotator (submitter) replies to a reviewer's feedback note. Writes
 * an `annotation.review_replied` event so the thread is reconstructable
 * via the event log — same pattern as the verdict events themselves.
 *
 * Authorization: only the original submitter may reply. We resolve
 * topic → task → workspace defensively to ensure the message lands in
 * the right workspace event log.
 *
 * Idempotency: not enforced — successive replies stack up as separate
 * events, which is the desired behavior for a chat-style thread.
 */
export async function respondToReview(
  input: z.infer<typeof respondToReviewSchema>,
): Promise<{ ok: true; eventId: string }> {
  const parsed = respondToReviewSchema.parse(input)
  const trimmed = parsed.message.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('Reply cannot be blank.')
  }

  const db = getDb()
  const [annotation] = await db
    .select()
    .from(annotations)
    .where(eq(annotations.id, parsed.annotationId))
    .limit(1)
  if (!annotation) throw new NotFoundError('Annotation')

  const me = await requireUser()
  if (annotation.userId !== me.id) {
    throw new ForbiddenError(
      'Only the original submitter can reply to a review.',
    )
  }

  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, annotation.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const [evt] = await db
    .insert(events)
    .values({
      type: 'annotation.review_replied',
      workspaceId: task.workspaceId,
      actorId: me.id,
      payload: {
        annotationId: parsed.annotationId,
        topicId: topic.id,
        taskId: task.id,
        submitterUserId: me.id,
        message: trimmed,
      },
    })
    .returning({ id: events.id })

  return { ok: true as const, eventId: evt.id }
}
