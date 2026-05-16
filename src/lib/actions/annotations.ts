'use server'
import { z } from 'zod'
import { after } from 'next/server'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { tasks, topics, annotations, events } from '@/lib/db/schema'
import {
  requireUser,
  requireWorkspaceAdmin,
  requireWorkspaceMember,
} from '@/lib/auth/guards'
import { fanoutWebhook } from '@/lib/webhooks/fanout'
import { emitNotification } from '@/lib/notifications/emit'
import { uuidLike } from '@/lib/validators/uuid'
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
  topicId: uuidLike,
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
  const db = getDb()

  // Resolve topic → task → workspace BEFORE the auth check so we
  // authorize against the right workspace (defends against a malicious
  // topicId pointing at another workspace's topic).
  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, parsed.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const { user } = await requireWorkspaceMember(task.workspaceId)

  // Auto-claim: first save by any workspace member on an unassigned
  // topic claims it. After that, only the claimant may save further
  // drafts. This is the "first to start working" model — admins can
  // pre-assign for fairness flows, but the default is grab-as-you-go.
  if (topic.assignedTo === null) {
    await db
      .update(topics)
      .set({ assignedTo: user.id })
      .where(eq(topics.id, topic.id))
    topic.assignedTo = user.id
  } else if (topic.assignedTo !== user.id) {
    throw new ForbiddenError(
      'This topic is claimed by another annotator. Pick a different one.',
    )
  }
  if (topic.status !== 'drafting' && topic.status !== 'revising') {
    throw new ConflictError(`Topic is ${topic.status} — drafting closed.`)
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
  topicId: uuidLike,
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
  const db = getDb()

  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, parsed.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const { user } = await requireWorkspaceMember(task.workspaceId)

  // Auto-claim: same model as saveDraftAnnotation. A user who jumps
  // straight to submit (no prior save) on an unclaimed topic still
  // becomes the claimant.
  if (topic.assignedTo === null) {
    await db
      .update(topics)
      .set({ assignedTo: user.id })
      .where(eq(topics.id, topic.id))
    topic.assignedTo = user.id
  } else if (topic.assignedTo !== user.id) {
    throw new ForbiddenError(
      'This topic is claimed by another annotator.',
    )
  }
  if (topic.status !== 'drafting' && topic.status !== 'revising') {
    throw new ConflictError(`Topic is ${topic.status} — cannot submit.`)
  }

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
  annotationId: uuidLike,
  decision: z.enum(['approve', 'reject', 'request_revision']),
  feedback: z.string().max(2000).optional(),
})

/**
 * Workspace admin reviews a submitted annotation. This is the FINAL
 * acceptance step in the 3-role flow (annotator → qc → admin).
 *
 * Allowed source states:
 *   - 'submitted'             — admin acts directly, skipping the QC stage
 *   - 'reviewing'             — QC was working on it but admin steps in
 *   - 'awaiting_acceptance'   — QC has already passed it; this is the
 *                               normal acceptance path
 *
 * Transitions:
 *   approve          → 'approved'   (terminal, locks payout + IAA + webhooks)
 *   reject           → 'rejected'   (terminal)
 *   request_revision → 'revising'   (back to annotator)
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

  if (
    topic.status !== 'submitted' &&
    topic.status !== 'reviewing' &&
    topic.status !== 'awaiting_acceptance'
  ) {
    throw new ConflictError(
      `Cannot accept-review an annotation whose topic is ${topic.status}.`,
    )
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

  // Notify the submitter their work was reviewed. Skip the self-case
  // (admin reviewing their own annotation — unusual but possible). The
  // emit helper swallows errors, so a notification hiccup never blocks
  // the verdict commit.
  if (annotation.userId !== user.id) {
    const { title, body, type: notifType } = verdictNotificationCopy(
      parsed.decision,
      parsed.feedback,
    )
    await emitNotification({
      userId: annotation.userId,
      workspaceId: task.workspaceId,
      type: notifType,
      title,
      body,
      linkUrl: `/workspaces/${task.workspaceId}/topics/${topic.id}/annotate?annotationId=${annotation.id}`,
      payload: {
        decision: parsed.decision,
        annotationId: annotation.id,
        topicId: topic.id,
        taskId: task.id,
        templateMode: task.templateMode,
      },
      actorId: user.id,
    })
  }

  // Fire any registered webhook subscribers AFTER the response — keeps the
  // admin's review action snappy even when downstream receivers are slow.
  after(() =>
    fanoutWebhook({
      type: event,
      workspaceId: task.workspaceId,
      payload: {
        annotationId: annotation.id,
        topicId: topic.id,
        taskId: task.id,
        submitterUserId: annotation.userId,
        decision: parsed.decision,
        feedback: parsed.feedback ?? null,
      },
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('webhook fanout failed', e)
    }),
  )

  return { ok: true as const }
}

/**
 * Render the inbox row title/body/type for a given verdict decision.
 * Centralized here (instead of inline) so QC + admin paths produce
 * identical inbox UX for the same outcome.
 */
function verdictNotificationCopy(
  decision: 'approve' | 'reject' | 'request_revision',
  feedback: string | null | undefined,
): { type: string; title: string; body?: string } {
  const trimmed = feedback?.trim() ? feedback.trim().slice(0, 140) : undefined
  if (decision === 'approve') {
    return {
      type: 'annotation.approved',
      title: 'Your annotation was approved',
      body: trimmed,
    }
  }
  if (decision === 'reject') {
    return {
      type: 'annotation.rejected',
      title: 'Your annotation was rejected',
      body: trimmed ?? 'Open the annotation to see the reviewer’s notes.',
    }
  }
  return {
    type: 'annotation.revising',
    title: 'Reviewer asked for a revision',
    body: trimmed ?? 'Open the annotation to see what to fix.',
  }
}

// ─── Review thread — submitter replies to a reviewer's feedback ───────────

const respondToReviewSchema = z.object({
  annotationId: uuidLike,
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

  // Notify the most recent reviewer that the submitter wrote back.
  // We pick the latest verdict/qc event on this annotation as the
  // notification target — that's the person whose decision triggered
  // this reply. If multiple reviewers are involved we only ping the
  // most recent; full participant-list fan-out is overkill for v1.
  const reviewerEvents = await db
    .select({ actorId: events.actorId })
    .from(events)
    .where(
      and(
        eq(events.workspaceId, task.workspaceId),
        sql`${events.payload} ->> 'annotationId' = ${parsed.annotationId}`,
        sql`${events.type} IN ('annotation.approved', 'annotation.rejected', 'annotation.revised', 'annotation.qc_passed')`,
      ),
    )
    .orderBy(desc(events.ts))
    .limit(1)
  const lastReviewerId = reviewerEvents[0]?.actorId ?? null
  if (lastReviewerId && lastReviewerId !== me.id) {
    await emitNotification({
      userId: lastReviewerId,
      workspaceId: task.workspaceId,
      type: 'review.reply',
      title: 'New reply on a review you wrote',
      body: trimmed.slice(0, 140),
      linkUrl: `/workspaces/${task.workspaceId}/topics/${topic.id}/annotate?annotationId=${parsed.annotationId}`,
      payload: {
        annotationId: parsed.annotationId,
        topicId: topic.id,
        taskId: task.id,
      },
      actorId: me.id,
    })
  }

  return { ok: true as const, eventId: evt.id }
}
