'use server'

/**
 * QC review action — the intermediate quality-check step between
 * annotator submission and admin acceptance in the 3-role flow.
 *
 * Role permissions:
 *   - admin can call this (admin is a superset of qc)
 *   - qc can call this
 *   - annotator / viewer cannot
 *
 * Decisions QC can render:
 *   - `pass`              → escalates the annotation to admin acceptance.
 *                           Topic transitions: submitted | reviewing →
 *                           awaiting_acceptance. Emits `annotation.qc_passed`.
 *   - `request_revision`  → 打回 — sends back to annotator for fixes.
 *                           Topic transitions: submitted | reviewing →
 *                           revising. Emits `annotation.revised` (the
 *                           same event admin's revision request uses; the
 *                           actor's role distinguishes them in the
 *                           review-thread view).
 *
 * What QC cannot do:
 *   - Terminal reject. Real ops keep the kill decision with admin so
 *     payout flow has a single source of authority. If QC thinks an
 *     annotation is hopeless, they pass it through with a damning
 *     comment and admin makes the final call.
 *
 * Concurrency: optimistic-lock on topic.version (same pattern as
 * reviewAnnotation). The state-transition rejects whatever's already
 * been accepted/rejected.
 */

import { z } from 'zod'
import { after } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  tasks,
  topics,
} from '@/lib/db/schema'
import { requireWorkspaceQC } from '@/lib/auth/guards'
import {
  ConflictError,
  NotFoundError,
} from '@/lib/errors'
import { fanoutWebhook } from '@/lib/webhooks/fanout'

const qcReviewSchema = z.object({
  annotationId: z.string().uuid(),
  decision: z.enum(['pass', 'request_revision']),
  /** QC's note. Required when 打回; optional but useful for `pass`. */
  feedback: z.string().max(2000).optional(),
})

export async function qcReviewAnnotation(
  input: z.infer<typeof qcReviewSchema>,
): Promise<{ ok: true; next: 'awaiting_acceptance' | 'revising' }> {
  const parsed = qcReviewSchema.parse(input)
  const db = getDb()

  // Resolve the annotation → topic → task → workspace BEFORE the auth
  // check so we can authorize against the right workspace (defends
  // against a malicious annotationId pointing at someone else's
  // workspace).
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

  const { user, role } = await requireWorkspaceQC(task.workspaceId)

  // QC can only act on annotations in flight. Anything already accepted /
  // rejected / awaiting acceptance is past the QC stage.
  if (topic.status !== 'submitted' && topic.status !== 'reviewing') {
    throw new ConflictError(
      `Cannot QC-review an annotation whose topic is ${topic.status}.`,
    )
  }
  // Don't allow self-QC: the submitter can't QC their own work.
  if (annotation.userId === user.id) {
    throw new ConflictError(
      'You submitted this annotation — find another QC reviewer.',
    )
  }

  const transition = {
    pass: {
      next: 'awaiting_acceptance' as const,
      event: 'annotation.qc_passed' as const,
    },
    request_revision: {
      next: 'revising' as const,
      event: 'annotation.revised' as const,
    },
  } satisfies Record<
    typeof parsed.decision,
    { next: 'awaiting_acceptance' | 'revising'; event: string }
  >
  const { next, event } = transition[parsed.decision]

  const updated = await db
    .update(topics)
    .set({ status: next, version: topic.version + 1 })
    .where(
      and(eq(topics.id, topic.id), eq(topics.version, topic.version)),
    )
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
      submitterUserId: annotation.userId,
      decision: parsed.decision,
      feedback: parsed.feedback ?? null,
      taskId: task.id,
      templateMode: task.templateMode,
      // Distinguishes QC verdict from admin verdict when both use the
      // same `annotation.revised` event type. The review-thread reader
      // uses this to color the message correctly.
      reviewerRole: role,
    },
  })

  // Fire webhooks AFTER the response so QC's click stays snappy.
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
        reviewerRole: role,
      },
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('webhook fanout failed (qc-review):', e)
    }),
  )

  return { ok: true, next }
}
