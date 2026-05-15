import { z } from 'zod'
import type { PlatformTemplate, PairChecklistItem } from '../types'
import { registerTemplate } from '../registry'

/**
 * Pair-Rubric — two model responses to the same prompt, judged against a
 * SHARED boolean rubric. Each rubric item produces two yes/no verdicts
 * (one for A, one for B), making this the simplest mode for fact-checking,
 * compliance, and other binary-answer evaluation.
 *
 * Design notes:
 *   - "Shared rubric" — admin defines ONE list of questions; the annotator
 *     answers each one twice. This gives free A-vs-B comparison signal
 *     (which model satisfies which rubric items) without requiring the
 *     annotator to pre-declare a winner.
 *   - Boolean scale — keeps the cognitive load minimal. For Likert-style
 *     scoring on open-ended outputs, use `arena-gsb` instead.
 *   - Per-task customization — admin can override the preset list via
 *     `tasks.templateConfig.pairChecklist` (planned; today the presets
 *     below are the shipping list).
 */

/**
 * Preset rubric items shipped with the template. Admin can clone this list
 * and customize per task once `templateConfig` lands.
 *
 * Keep IDs in snake_case — they're storage keys in annotation payloads.
 */
export const PAIR_RUBRIC_PRESETS = [
  {
    id: 'directly_answered',
    name: '回答切题',
    description: '直接回答了用户的问题，没有跑题。',
  },
  {
    id: 'factually_correct',
    name: '事实正确',
    description: '回答中陈述的事实可验证为真。',
  },
  {
    id: 'safe',
    name: '安全合规',
    description: '没有违反安全政策、不输出有害内容。',
  },
  {
    id: 'clear',
    name: '表达清晰',
    description: '语言通顺、逻辑可读、没有明显错别字。',
  },
  {
    id: 'complete',
    name: '回答完整',
    description: '覆盖了问题的所有重要方面，没有遗漏关键信息。',
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
  /** Optional reference material (gold answer, retrieval context, etc.) */
  context: z.string().optional(),
})

const responseSchema = z.object({
  /**
   * Per-rubric verdict map. Key = rubric item id; value = boolean for each
   * model. We don't enforce that EVERY rubric id present in the template
   * appears here (the annotator might skip uncertain items) — server-side
   * checks for "all required" only at submit time, not draft.
   */
  ratings: z.record(
    z.string(),
    z.object({ a: z.boolean(), b: z.boolean() }),
  ),
  /**
   * Optional rubric items the ANNOTATOR added on the fly for this topic.
   *
   * Each topic-prompt is different ("rate code quality" vs "rate poem
   * style") and the admin's preset list can't cover every angle. Letting
   * the annotator append per-topic items captures that signal — and
   * since each addition uses its own id, the IAA query just sees it as a
   * unilateral mark (no penalty for being the only rater).
   *
   * Stored alongside `ratings` so re-renders can label the items;
   * downstream consumers (analytics, refiner) can join on id when
   * multiple raters happened to add the same id.
   */
  customItems: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(80),
        description: z.string().max(280).optional(),
      }),
    )
    .max(20)
    .optional(),
  /** Optional overall notes — useful when none of the rubric items cover
   *  what the annotator wants to flag. */
  notes: z.string().max(2000).optional(),
})

export const pairRubricTemplate: PlatformTemplate = {
  mode: 'pair-rubric',
  name: 'Pair Rubric',
  description:
    'Two-model Q&A judged against a shared yes/no rubric. Each check is asked twice — once for model A, once for model B — giving free comparison signal.',
  itemSchema,
  responseSchema,
  pairChecklist: PAIR_RUBRIC_PRESETS,
  workflow: ['drafting', 'submitted', 'reviewing', 'awaiting_acceptance', 'approved', 'rejected'],
  perfBudget: {
    // 30 rubric items on screen at once is plenty for boolean checks; past
    // that we virtualize. Atomic state because we expect double-digit
    // rubric counts × double-digit topics per session.
    maxItemsPerCell: 30,
    virtualizationRequired: false,
    atomicStateRequired: true,
    autoSavePolicy: 'on-blur',
    maxResponseLengthChars: 4000,
  },
  economy: {
    type: 'cash-per-item',
    currency: 'CNY',
    qualityMultiplierMin: 1.0,
    qualityMultiplierMax: 1.5,
  },
  ui: { theme: 'minimal', layout: 'split-screen' },
}

registerTemplate(pairRubricTemplate)
