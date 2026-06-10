import { ValidationError } from '@/lib/errors'

export const REVISION_FEEDBACK_REQUIRED_MESSAGE =
  'Feedback is required when sending work back for revision.'

export function normalizeReviewFeedback(
  feedback: string | null | undefined,
): string | undefined {
  const trimmed = feedback?.trim()
  return trimmed ? trimmed : undefined
}

export function assertRevisionFeedback(
  decision: string,
  feedback: string | null | undefined,
): void {
  if (decision !== 'request_revision') return
  if (normalizeReviewFeedback(feedback)) return
  throw new ValidationError(REVISION_FEEDBACK_REQUIRED_MESSAGE)
}
