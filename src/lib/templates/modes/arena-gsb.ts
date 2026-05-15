import { z } from 'zod'
import type { PlatformTemplate, PairChecklistItem } from '../types'
import { registerTemplate } from '../registry'

/**
 * Arena-GSB — two model responses, MULTI-DIMENSION 1-5 scoring per model,
 * with an explicit overall winner. The "GSB" (Good / Same / Bad)
 * judgments per dimension derive automatically from the score delta —
 * the annotator only fills in the underlying scores plus an overall
 * verdict and free-form reasoning.
 *
 * Design notes:
 *   - 1-5 Likert per dimension — gives more granularity than pure GSB
 *     while still being fast. Annotators don't need to remember to compare
 *     A and B explicitly; the scores are absolute.
 *   - Per-dimension GSB derives in projection — we don't store it; it's
 *     recomputable from (a, b) anywhere we need it.
 *   - Overall verdict is a separate field because total wins ≠ sum of
 *     dimension wins in cases where one dimension is more important.
 *     Annotator records what they actually think.
 *   - Reasoning REQUIRED (min 1 char) — the text is the high-value signal,
 *     not the scores themselves. LMSYS Chatbot Arena demonstrated raw scores
 *     are noisy; text rationales let downstream LLM-judge training calibrate.
 */

/**
 * Preset dimensions shipped with the template. Admin can swap or extend
 * per task once `templateConfig` lands.
 */
export const ARENA_GSB_PRESET_DIMENSIONS = [
  {
    id: 'helpfulness',
    name: '有用性',
    description: '回答对完成用户任务的实际帮助程度。',
  },
  {
    id: 'accuracy',
    name: '准确性',
    description: '回答中陈述的事实、数字、引用的准确性。',
  },
  {
    id: 'safety',
    name: '安全性',
    description: '不输出有害、违法、隐私泄露内容；正确拒绝越界请求。',
  },
  {
    id: 'conciseness',
    name: '简洁度',
    description: '不啰嗦、不重复、信息密度足够。',
  },
  {
    id: 'style',
    name: '风格质量',
    description: '语言流畅、用词得当、结构组织合理。',
  },
] as const satisfies readonly PairChecklistItem[]

const itemSchema = z.object({
  prompt: z.string().min(1),
  responseA: z.object({
    modelName: z.string().min(1),
    content: z.string().min(1),
  }),
  responseB: z.object({
    modelName: z.string().min(1),
    content: z.string().min(1),
  }),
  context: z.string().optional(),
})

const dimensionScoreSchema = z.object({
  a: z.number().int().min(1).max(5),
  b: z.number().int().min(1).max(5),
})

const responseSchema = z.object({
  /**
   * Per-dimension score map. Key = dimension id; value = { a: 1..5, b: 1..5 }.
   * Submit-time check: every dimension declared on the template MUST appear.
   */
  dimensions: z.record(z.string(), dimensionScoreSchema),
  /**
   * Annotator-added dimensions for this specific topic. Open-ended GSB
   * cases where the preset 5 dimensions don't cover an axis the rater
   * cares about (e.g. "rhyme scheme" for a poem). Each item is scored on
   * the same 1-5 scale via `dimensions[item.id]`.
   *
   * Same shape as the pair-rubric customItems; kept as a separate
   * optional field so the renderer can label them as custom.
   */
  customDimensions: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(80),
        description: z.string().max(280).optional(),
      }),
    )
    .max(20)
    .optional(),
  /** Overall verdict — not derived from dim scores because the annotator's
   *  weighting might disagree with a naive sum. */
  overallVerdict: z.enum(['a_better', 'tie', 'b_better']),
  /** Required free-form rationale — the high-value signal. */
  reasoning: z
    .string()
    .min(1, 'Reasoning is required — the text is the data we capture.')
    .max(4000),
})

export const arenaGsbTemplate: PlatformTemplate = {
  mode: 'arena-gsb',
  name: 'Arena GSB',
  description:
    'Two-model head-to-head, scored 1-5 across multiple dimensions. Per-dimension Good/Same/Bad derives from the deltas; overall winner + reasoning is recorded explicitly.',
  itemSchema,
  responseSchema,
  arenaDimensions: ARENA_GSB_PRESET_DIMENSIONS,
  workflow: ['drafting', 'submitted', 'reviewing', 'awaiting_acceptance', 'approved', 'rejected'],
  perfBudget: {
    maxItemsPerCell: 30,
    virtualizationRequired: false,
    atomicStateRequired: true,
    autoSavePolicy: 'on-blur',
    maxResponseLengthChars: 8000,
  },
  economy: {
    type: 'cash-per-item',
    currency: 'CNY',
    qualityMultiplierMin: 1.0,
    qualityMultiplierMax: 1.8, // open-ended rating is harder = better pay
  },
  ui: { theme: 'minimal', layout: 'split-screen' },
}

registerTemplate(arenaGsbTemplate)

/**
 * Derive per-dimension GSB verdict from a (a, b) score pair. Used by the
 * UI to show the implied verdict inline; also used by analytics to
 * aggregate "wins per dimension" across raters.
 */
export function dimensionGsb(
  a: number,
  b: number,
): 'A' | 'tie' | 'B' {
  if (a > b) return 'A'
  if (a < b) return 'B'
  return 'tie'
}
