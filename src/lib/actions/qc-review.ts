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
import { revalidatePath } from 'next/cache'
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
import { emitNotification } from '@/lib/notifications/emit'
import { recomputeAndPersistTrust } from '@/lib/quality/trust-recompute'

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

  // Notify the submitter. QC has two outcomes — pass (escalates to
  // admin acceptance, so submitter sees "your work passed QC") vs
  // request_revision (打回, submitter needs to fix it). Different
  // inbox titles so the user knows whether to relax or get to work.
  const trimmedFeedback = parsed.feedback?.trim().slice(0, 140) || undefined
  if (parsed.decision === 'pass') {
    await emitNotification({
      userId: annotation.userId,
      workspaceId: task.workspaceId,
      type: 'annotation.awaiting_acceptance',
      title: 'Passed QC — awaiting admin acceptance',
      body: trimmedFeedback,
      linkUrl: `/workspaces/${task.workspaceId}/topics/${topic.id}/annotate?annotationId=${annotation.id}`,
      payload: {
        annotationId: annotation.id,
        topicId: topic.id,
        taskId: task.id,
        reviewerRole: role,
      },
      actorId: user.id,
    })
  } else {
    await emitNotification({
      userId: annotation.userId,
      workspaceId: task.workspaceId,
      type: 'annotation.revising',
      title: 'QC asked for a revision',
      body: trimmedFeedback ?? 'Open the annotation to see what to fix.',
      linkUrl: `/workspaces/${task.workspaceId}/topics/${topic.id}/annotate?annotationId=${annotation.id}`,
      payload: {
        annotationId: annotation.id,
        topicId: topic.id,
        taskId: task.id,
        reviewerRole: role,
      },
      actorId: user.id,
    })
  }

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

  // Phase-9: same persistent-trust refresh as the admin verdict path.
  after(() =>
    recomputeAndPersistTrust({
      userId: annotation.userId,
      workspaceId: task.workspaceId,
      taskType: task.templateMode,
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[trust] recompute failed (qc-review)', e)
    }),
  )

  // Maintenance fix #6 + 3rd-audit follow-up: the verdict mutates
  // both workspace-side admin surfaces AND the annotator's own
  // /my/* views. Repaint both — without this an annotator clicks
  // 'inbox' right after their work was rejected and sees stale
  // 'submitted' status until they navigate away and back.
  revalidatePath(
    `/workspaces/${task.workspaceId}/topics/${topic.id}/annotate`,
  )
  revalidatePath(`/workspaces/${task.workspaceId}/tasks/${task.id}`)
  revalidatePath(`/workspaces/${task.workspaceId}/audit`)
  revalidatePath('/my/inbox')
  revalidatePath('/my/submissions')
  revalidatePath('/my/quality')
  revalidatePath('/my/tasks')
  revalidatePath(`/my/tasks/${task.id}`)
  return { ok: true, next }
}
