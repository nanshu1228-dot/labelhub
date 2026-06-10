/**
 * Task export review/audit field helpers.
 *
 * Keeps the HTTP route focused on authorization + data loading while
 * making the row-shaping contract easy to test. Every submitted
 * annotation export row should carry enough review context for a
 * downstream consumer to answer: what did AI say, what did humans do,
 * and where is the audit trail?
 */

export const REVIEW_EVENT_TYPES = [
  'ai_review.started',
  'ai_review.completed',
  'ai_review.sent_back',
  'ai_review.failed',
  'annotation.qc_passed',
  'annotation.approved',
  'annotation.rejected',
  'annotation.revised',
] as const

const HUMAN_REVIEW_EVENT_TYPES = new Set([
  'annotation.qc_passed',
  'annotation.approved',
  'annotation.rejected',
  'annotation.revised',
])

export type TaskExportAiVerdictRow = {
  annotationId: string
  status: string
  verdict: string | null
  scores: unknown
  reasoning: string | null
  attempts: number
  errorText: string | null
  startedAt: Date
  finishedAt: Date | null
}

export type TaskExportReviewEventRow = {
  type: string
  actorId: string | null
  payload: unknown
  ts: Date
}

export function latestAiVerdictByAnnotation(
  rows: TaskExportAiVerdictRow[],
): Map<string, TaskExportAiVerdictRow> {
  const out = new Map<string, TaskExportAiVerdictRow>()
  for (const row of rows) {
    const current = out.get(row.annotationId)
    if (!current || row.startedAt.getTime() > current.startedAt.getTime()) {
      out.set(row.annotationId, row)
    }
  }
  return out
}

export function reviewEventsByAnnotation(
  rows: TaskExportReviewEventRow[],
): Map<string, TaskExportReviewEventRow[]> {
  const out = new Map<string, TaskExportReviewEventRow[]>()
  for (const row of rows) {
    const payload = asRecord(row.payload)
    const annotationId =
      typeof payload.annotationId === 'string' ? payload.annotationId : null
    if (!annotationId) continue
    const list = out.get(annotationId) ?? []
    list.push(row)
    out.set(annotationId, list)
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.ts.getTime() - b.ts.getTime())
  }
  return out
}

export function buildTaskReviewExportFields(opts: {
  annotationId: string
  aiVerdict?: TaskExportAiVerdictRow
  reviewEvents?: TaskExportReviewEventRow[]
}): Record<string, unknown> {
  const aiScores = asRecord(opts.aiVerdict?.scores)
  const aiScore =
    typeof aiScores.__score === 'number' ? aiScores.__score : null
  const aiConfidence =
    typeof aiScores.__confidence === 'number' ? aiScores.__confidence : null
  const aiModel =
    typeof aiScores.__model === 'string' ? aiScores.__model : ''
  const aiDimensions = extractAiDimensions(aiScores)
  const events = opts.reviewEvents ?? []
  const compactEvents = events.map(compactReviewEvent)
  const latestHuman = [...events]
    .reverse()
    .find((event) => HUMAN_REVIEW_EVENT_TYPES.has(event.type))
  const humanPayload = asRecord(latestHuman?.payload)

  return {
    ai_review_status: opts.aiVerdict?.status ?? '',
    ai_review_verdict: opts.aiVerdict?.verdict ?? '',
    ai_review_score: aiScore,
    ai_review_confidence: aiConfidence,
    ai_review_model: aiModel,
    ai_review_dimensions: aiDimensions,
    ai_review_reasoning: opts.aiVerdict?.reasoning ?? '',
    ai_review_attempts: opts.aiVerdict?.attempts ?? null,
    ai_review_error: opts.aiVerdict?.errorText ?? '',
    ai_review_started_at: opts.aiVerdict?.startedAt.toISOString() ?? '',
    ai_review_finished_at: opts.aiVerdict?.finishedAt?.toISOString() ?? '',
    human_review_type: latestHuman?.type ?? '',
    human_review_decision:
      typeof humanPayload.decision === 'string'
        ? humanPayload.decision
        : latestHuman
          ? inferDecisionFromEventType(latestHuman.type)
          : '',
    human_review_feedback:
      typeof humanPayload.feedback === 'string' ? humanPayload.feedback : '',
    human_review_role:
      typeof humanPayload.reviewerRole === 'string'
        ? humanPayload.reviewerRole
        : latestHuman?.type === 'annotation.qc_passed'
          ? 'qc'
          : latestHuman
            ? 'admin'
            : '',
    reviewed_at: latestHuman?.ts.toISOString() ?? '',
    review_event_count: compactEvents.length,
    review_events: compactEvents,
  }
}

function compactReviewEvent(event: TaskExportReviewEventRow) {
  const payload = asRecord(event.payload)
  return {
    type: event.type,
    at: event.ts.toISOString(),
    actor_id: event.actorId,
    decision:
      typeof payload.decision === 'string'
        ? payload.decision
        : inferDecisionFromEventType(event.type),
    feedback:
      typeof payload.feedback === 'string'
        ? payload.feedback
        : typeof payload.reason === 'string'
          ? payload.reason
          : '',
    reviewer_role:
      typeof payload.reviewerRole === 'string' ? payload.reviewerRole : '',
    verdict: typeof payload.verdict === 'string' ? payload.verdict : '',
    score: typeof payload.score === 'number' ? payload.score : null,
    error: typeof payload.error === 'string' ? payload.error : '',
  }
}

function inferDecisionFromEventType(type: string): string {
  if (type === 'annotation.approved') return 'approve'
  if (type === 'annotation.rejected') return 'reject'
  if (type === 'annotation.revised') return 'request_revision'
  if (type === 'annotation.qc_passed') return 'pass'
  if (type === 'ai_review.sent_back') return 'send_back'
  if (type === 'ai_review.completed') return 'completed'
  if (type === 'ai_review.failed') return 'failed'
  if (type === 'ai_review.started') return 'started'
  return ''
}

type AiDimensionScore = {
  score: number | null
  reasoning: string
  evidence: string[]
}

/**
 * Normalize the per-dimension `scores` map into a stable, export-friendly
 * shape. Filters out `__`-prefixed metadata keys (e.g. `__score`, `__model`)
 * and accepts BOTH the current `{ score, reasoning, evidence }` object shape
 * and the LEGACY bare-number shape (`scores[dimId] = number`).
 */
function extractAiDimensions(
  scores: Record<string, unknown>,
): Record<string, AiDimensionScore> {
  const out: Record<string, AiDimensionScore> = {}
  for (const [key, value] of Object.entries(scores)) {
    if (key.startsWith('__')) continue
    if (typeof value === 'number') {
      out[key] = { score: value, reasoning: '', evidence: [] }
      continue
    }
    const dim = asRecord(value)
    out[key] = {
      score: typeof dim.score === 'number' ? dim.score : null,
      reasoning: typeof dim.reasoning === 'string' ? dim.reasoning : '',
      evidence: Array.isArray(dim.evidence)
        ? dim.evidence.filter(
            (item): item is string => typeof item === 'string',
          )
        : [],
    }
  }
  return out
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}
