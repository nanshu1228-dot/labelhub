'use server'

/**
 * Batch review action — Finals P3 D11.
 *
 * Spec 4.5 calls out batch ops by name. This action wraps the
 * existing per-annotation review path so reviewers can clear a
 * 20-item queue in <2 min (the plan's gate).
 *
 * Implementation:
 *   - Validate the input list (≤200 items per batch — UX cap to
 *     keep the spinner from hanging > 30s)
 *   - For each annotation, call the appropriate per-row review path
 *     (qcReviewAnnotation for pre-final QC pass/send-back; admin's
 *     reviewAnnotation for final acceptance rows that are already
 *     awaiting_acceptance)
 *   - Collect per-row results into { succeeded, failed } so the UI
 *     can surface partial-success
 *
 * Each row's auth + state-transition check runs independently — a
 * cross-workspace mix in the same batch is fine; rows whose
 * workspace the user can't QC throw and end up in `failed`.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { reviewAnnotation } from './annotations'
import { qcReviewAnnotation } from './qc-review'
import { uuidLike } from '@/lib/validators/uuid'
import {
  assertRevisionFeedback,
  normalizeReviewFeedback,
} from '@/lib/quality/review-feedback'

export type BatchDecision = 'approve' | 'request_revision'

const inputSchema = z.object({
  annotationIds: z.array(uuidLike).min(1).max(200),
  decision: z.enum(['approve', 'request_revision']),
  feedback: z.string().max(2000).optional(),
  /**
   * Optional UI-provided status hints from /review. The server actions
   * still enforce authorization and state legality; this only selects
   * which canonical per-row action to attempt.
   */
  stages: z
    .record(
      uuidLike,
      z.enum([
        'submitted',
        'ai_review',
        'reviewing',
        'awaiting_acceptance',
        'drafting',
        'revising',
        'approved',
        'rejected',
      ]),
    )
    .optional(),
})

export interface BatchReviewResult {
  succeeded: string[]
  failed: Array<{ annotationId: string; error: string }>
}

/**
 * Apply the same review decision to up to 200 annotations.
 *
 * `approve` maps to qcReviewAnnotation's `pass` for submitted /
 * reviewing work. When the selected row is already awaiting admin
 * acceptance, it maps to reviewAnnotation's terminal `approve`.
 *
 * `request_revision` maps to qcReviewAnnotation's `request_revision`
 * (annotation returns to drafting). Reason is required server-side so
 * every send-back leaves actionable submitter feedback.
 */
export async function batchReviewAnnotations(
  input: z.infer<typeof inputSchema>,
): Promise<BatchReviewResult> {
  const parsed = inputSchema.parse(input)
  assertRevisionFeedback(parsed.decision, parsed.feedback)
  const feedback = normalizeReviewFeedback(parsed.feedback)
  const succeeded: string[] = []
  const failed: BatchReviewResult['failed'] = []

  // Per-row sequential dispatch — concurrent updates against the same
  // topic version would race; sequential keeps optimistic-lock failures
  // predictable. The spinner UX absorbs the ~200ms × N latency.
  for (const id of parsed.annotationIds) {
    try {
      const stageHint = parsed.stages?.[id]
      if (parsed.decision === 'approve' && stageHint === 'awaiting_acceptance') {
        await reviewAnnotation({
          annotationId: id,
          decision: 'approve',
          feedback,
        })
      } else {
        await qcReviewAnnotation({
          annotationId: id,
          decision: parsed.decision === 'approve' ? 'pass' : 'request_revision',
          feedback,
        })
      }
      succeeded.push(id)
    } catch (e) {
      failed.push({
        annotationId: id,
        error: e instanceof Error ? e.message : 'unknown',
      })
    }
  }

  // Repaint the queue list so the reviewer sees the cleared rows.
  revalidatePath('/review')

  return { succeeded, failed }
}
