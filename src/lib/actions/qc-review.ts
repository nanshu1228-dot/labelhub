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
  applyTransition,
  IllegalTransitionError,
  type StageAction,
} from '@/lib/quality/state-machine'
import {
  ConflictError,
  NotFoundError,
} from '@/lib/errors'
import { fanoutWebhook } from '@/lib/webhooks/fanout'
import { emitNotification } from '@/lib/notifications/emit'
import { recomputeAndPersistTrust } from '@/lib/quality/trust-recompute'
import {
  assertRevisionFeedback,
  normalizeReviewFeedback,
} from '@/lib/quality/review-feedback'

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
  assertRevisionFeedback(parsed.decision, parsed.feedback)
  const feedback = normalizeReviewFeedback(parsed.feedback)
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

  // Don't allow self-QC: the submitter can't QC their own work.
  if (annotation.userId === user.id) {
    throw new ConflictError(
      'You submitted this annotation — find another QC reviewer.',
    )
  }

  // Delegate the legality + role check to the canonical state machine
  // (src/lib/quality/state-machine.ts). The machine throws
  // IllegalTransitionError when the topic isn't in submitted/reviewing
  // (covers what the ad-hoc check used to do) and ForbiddenRoleError
  // when the role doesn't match.
  const action: StageAction =
    parsed.decision === 'pass' ? 'qc_pass' : 'qc_request_revision'
  let transition: ReturnType<typeof applyTransition>
  try {
    // requireWorkspaceQC narrowed `role` to admin|qc above. The
    // state machine's Actor type is the same set + 'annotator'|'ai';
    // a cast is safe here.
    transition = applyTransition({
      from: topic.status,
      action,
      role: role as 'admin' | 'qc',
    })
  } catch (e) {
    if (e instanceof IllegalTransitionError) {
      throw new ConflictError(
        `Cannot QC-review an annotation whose topic is ${topic.status}.`,
      )
    }
    throw e
  }
  const next = transition.to as 'awaiting_acceptance' | 'revising'
  const event =
    parsed.decision === 'pass' ? 'annotation.qc_passed' : 'annotation.revised'

  // QC verdict state-change + its audit event, atomically — no status flip
  // without the trail, and no trail without the flip (mirrors the
  // reviewAnnotation admin path). The version CAS still guards concurrent
  // edits; a 0-row update rolls the whole tx back with ConflictError.
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(topics)
      .set({ status: next, version: topic.version + 1 })
      .where(and(eq(topics.id, topic.id), eq(topics.version, topic.version)))
      .returning()
    if (updated.length === 0) {
      throw new ConflictError(
        'Topic was modified concurrently — refresh and try again.',
      )
    }

    await tx.insert(events).values({
      type: event,
      workspaceId: task.workspaceId,
      actorId: user.id,
      payload: {
        topicId: topic.id,
        annotationId: annotation.id,
        submitterUserId: annotation.userId,
        decision: parsed.decision,
        feedback: feedback ?? null,
        taskId: task.id,
        templateMode: task.templateMode,
        // Distinguishes QC verdict from admin verdict when both use the
        // same `annotation.revised` event type. The review-thread reader
        // uses this to color the message correctly.
        reviewerRole: role,
      },
    })
  })

  // Notify the submitter. QC has two outcomes — pass (escalates to
  // admin acceptance, so submitter sees "your work passed QC") vs
  // request_revision (打回, submitter needs to fix it). Different
  // inbox titles so the user knows whether to relax or get to work.
  const trimmedFeedback = feedback?.slice(0, 140)
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
        feedback: feedback ?? null,
        reviewerRole: role,
      },
    }).catch((e) => {
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
