/**
 * Pure reshape: a raw dataset-version manifest item → the minimal
 * trainable record (`TeachingItem`) consumed by trl/transformers
 * DPOTrainer or SFTTrainer with a one-line key remap.
 *
 * Lives outside the export route handler so the maintenance-pass
 * test (`teaching-reshape.test.ts`) can exercise it without an HTTP
 * fixture. The route imports + delegates.
 *
 * Skip rule: items without a `claudeProposal` aren't a teaching
 * signal — they're a label with no AI baseline to compare against.
 * Returns null so the caller filters them out cheaply.
 */

export interface TeachingItem {
  /** Stable id so a follow-up training run can dedupe. */
  id: string
  /** User-facing prompt extracted from the source topic. Falls back
   *  to null if itemData doesn't carry a recognized prompt key —
   *  the raw itemData is always preserved in `source.itemData`. */
  prompt: string | null
  ai_proposal: unknown
  human_correction: unknown
  delta_summary: string | null
  reasoning: string | null
  template_mode: string
  source: {
    annotationId: string
    topicId: string
    taskId: string
    raterUserId: string
    submittedAt: string | null
    itemData: unknown
  }
}

export interface RawManifestItem {
  annotationId: string
  topicId: string
  taskId: string
  userId: string
  payload: unknown
  claudeProposal?: unknown
  deltaSummary?: string | null
  reasoningText?: string | null
  itemData?: unknown
  submittedAt: string | null
  templateMode: string
}

/** Common itemData shapes we know about. Order matters — first match
 *  wins. The whole itemData is always preserved on `source.itemData`. */
const PROMPT_KEYS = ['prompt', 'question', 'input_text', 'text'] as const

export function reshapeTeaching(item: unknown): TeachingItem | null {
  if (!item || typeof item !== 'object') return null
  const r = item as RawManifestItem
  if (r.claudeProposal === undefined || r.claudeProposal === null)
    return null

  let prompt: string | null = null
  const itemData = r.itemData
  if (itemData && typeof itemData === 'object') {
    const d = itemData as Record<string, unknown>
    for (const key of PROMPT_KEYS) {
      const v = d[key]
      if (typeof v === 'string' && v.length > 0) {
        prompt = v
        break
      }
    }
  }

  return {
    id: r.annotationId,
    prompt,
    ai_proposal: r.claudeProposal,
    human_correction: r.payload,
    delta_summary: r.deltaSummary ?? null,
    reasoning: r.reasoningText ?? null,
    template_mode: r.templateMode,
    source: {
      annotationId: r.annotationId,
      topicId: r.topicId,
      taskId: r.taskId,
      raterUserId: r.userId,
      submittedAt: r.submittedAt,
      itemData: r.itemData ?? null,
    },
  }
}
