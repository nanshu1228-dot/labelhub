import { z } from 'zod'
import type { PlatformTemplate } from '../types'
import { registerTemplate } from '../registry'

/**
 * Rubric-Judgment — single model response, expert-authored rubric + verdict.
 *
 * The workflow this models (the highest-value 标注端 AI-checker scenario):
 *   1. a model RESPONSE to a prompt is pre-generated and shown to the expert
 *   2. the expert AUTHORS a rubric — a list of concrete pass/fail criteria the
 *      response should satisfy for THIS prompt
 *   3. the expert judges the response against their own rubric: a pass/fail per
 *      criterion + an overall pass/fail verdict
 *
 * The AI review agent (taskKind 'rubric_judgment') then META-REVIEWS the
 * expert's work in two passes — rubric quality + judgement correctness — see
 * src/lib/ai/review-agent.ts. Unlike `pair-rubric`, the rubric is the LABELER's
 * own output (not an owner preset) and the subject is ONE response judged
 * pass/fail, not a pairwise A-vs-B comparison.
 */

/** The pre-generated item under review: a prompt + the model response to judge. */
const itemSchema = z.object({
  /** The user prompt / question the response is answering. */
  prompt: z.string().min(1),
  /** The model response the expert must judge. */
  response: z.object({
    modelName: z.string().min(1).optional(),
    content: z.string().min(1),
  }),
  /** Optional reference material (gold answer, retrieval context, etc.). */
  context: z.string().optional(),
})

/**
 * What the expert submits: the rubric they AUTHORED + their judgement.
 *
 *   - rubricItems    — the criteria the expert wrote for this response. Each is
 *                      a concrete check; `expectation` sharpens what a PASS means.
 *   - judgments      — per-criterion pass/fail, keyed by rubric item id.
 *   - overallVerdict — the expert's overall call on the response.
 *   - notes          — free-text rationale / edge cases.
 *
 * Storage keys live in `annotations.payload`. Keep `rubricItems[].id` stable
 * once rows exist — `judgments` is keyed on it.
 */
const responseSchema = z.object({
  rubricItems: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(120),
        description: z.string().max(400).optional(),
        /** What a PASS looks like for this criterion (optional, sharpens it). */
        expectation: z.string().max(400).optional(),
      }),
    )
    .min(1)
    .max(20),
  judgments: z.record(z.string(), z.enum(['pass', 'fail'])),
  overallVerdict: z.enum(['pass', 'fail']),
  notes: z.string().max(2000).optional(),
})

export const rubricJudgmentTemplate: PlatformTemplate = {
  mode: 'rubric-judgment',
  name: 'Rubric Judgment',
  description:
    'A single model response is judged: the expert authors a pass/fail rubric for it and records a verdict. The AI checker audits both the rubric quality and whether the judgement is correct.',
  itemSchema,
  responseSchema,
  workflow: [
    'drafting',
    'submitted',
    'ai_review',
    'reviewing',
    'awaiting_acceptance',
    'approved',
    'rejected',
  ],
  perfBudget: {
    // Up to 20 authored criteria on screen; boolean-ish controls, no virtualization.
    maxItemsPerCell: 20,
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
  ui: { theme: 'minimal', layout: 'single-column' },
}

registerTemplate(rubricJudgmentTemplate)
