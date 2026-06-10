/**
 * AI Review Agent config — pure schema + defaults (Finals P2 D9).
 *
 * Split out of `ai-agent-config.ts` because that file is 'use server'
 * and Next.js 16 restricts 'use server' modules to async-function
 * exports only. The schema + constants land here so both the server
 * action file and the client form can import them.
 */

import { z } from 'zod'
import { reviewDimensionSchema } from '@/lib/ai/review-agent'

export const aiAgentConfigSchema = z
  .object({
    enabled: z.boolean(),
    promptTemplate: z.string().max(8_000),
    dimensions: z.array(reviewDimensionSchema).max(10),
    passAt: z.number().min(0).max(100),
    sendBackAt: z.number().min(0).max(100),
    tier: z.enum(['fast', 'default', 'premium']).default('fast'),
    /**
     * Self-consistency sample count (spec §5 评分稳定性). 1 = a single
     * deterministic (temperature-0) verdict — cheapest, the default. 2-5 runs
     * N varied samples and aggregates by median score + majority verdict,
     * yielding an agreement-based confidence. Higher N = steadier but costlier.
     */
    samples: z.number().int().min(1).max(5).default(1),
    /**
     * Task shape, so the agent reasons in the right frame:
     *  - qa_quality         — judge a single answer against a reference
     *  - preference_compare — audit a pairwise A/B/tie preference (re-derive the
     *    better response + check the labeler's choice, position-bias aware)
     *  - rubric_judgment    — META-REVIEW: the labeler authored a rubric for a
     *    single response and judged it pass/fail; the agent audits rubric
     *    quality + judgement correctness (pairs with the 'rubric-judgment'
     *    template mode). See DEFAULT_RUBRIC_JUDGMENT_CONFIG.
     *  - generic            — default single-submission framing
     */
    taskKind: z
      .enum(['qa_quality', 'preference_compare', 'rubric_judgment', 'generic'])
      .default('generic'),
  })
  .refine((c) => c.sendBackAt < c.passAt, {
    message: 'sendBackAt must be strictly less than passAt.',
    path: ['sendBackAt'],
  })

export type AiAgentConfig = z.infer<typeof aiAgentConfigSchema>

/**
 * Default starter config — what an owner sees the first time they open the
 * page. Ships a fully-worked, WEIGHTED + ANCHORED rubric so owners see the
 * intended depth of "可配置评测标准" (not just bare dimension names). Matches
 * the scheduler's fallback defaults so the UI shows what's actually in flight
 * before any save.
 */
export const DEFAULT_AI_AGENT_CONFIG: AiAgentConfig = {
  enabled: false,
  promptTemplate:
    'Review this annotation against the task instructions. Grade each dimension on its anchors, quote the submission as evidence, and pass only what is publishable as training data.',
  dimensions: [
    {
      id: 'accuracy',
      name: 'Accuracy',
      description: 'Is the annotation factually correct and faithful to the source item?',
      weight: 50,
      anchors: {
        excellent: '90-100: fully correct, no factual errors.',
        acceptable: '50-89: mostly correct with minor, non-critical issues.',
        failing: '0-49: contains a clear factual error or contradicts the source.',
      },
    },
    {
      id: 'completeness',
      name: 'Completeness',
      description: 'Are all required fields answered with sufficient detail?',
      weight: 30,
      anchors: {
        excellent: '90-100: every field thoroughly addressed.',
        acceptable: '50-89: minor gaps that do not block use.',
        failing: '0-49: required fields missing or empty.',
      },
    },
    {
      id: 'clarity',
      name: 'Clarity',
      description: 'Is the response clear, well-structured, and unambiguous?',
      weight: 20,
      anchors: {
        excellent: '90-100: crisp and unambiguous.',
        acceptable: '50-89: understandable with minor awkwardness.',
        failing: '0-49: confusing or self-contradictory.',
      },
    },
  ],
  passAt: 70,
  sendBackAt: 40,
  tier: 'fast',
  samples: 1,
  taskKind: 'generic',
}

/**
 * Default config for the `rubric-judgment` template mode — the rubric-authoring
 * + judgement meta-review. Two weighted, anchored dimensions:
 *   - rubric_quality (40)       — did the labeler write a GOOD rubric?
 *   - judgment_correctness (60) — is the labeler's pass/fail call CORRECT?
 * judgment_correctness is weighted higher (a wrong verdict is the more damaging
 * error for training data) and is wired as the scheduler's `criticalDimension`,
 * so a wrong judgement can never auto-pass even behind a great rubric. Ships
 * enabled — the whole point of this mode is the AI meta-review.
 */
export const DEFAULT_RUBRIC_JUDGMENT_CONFIG: AiAgentConfig = {
  enabled: true,
  promptTemplate:
    'The labeler authored a pass/fail rubric for a single model response and ' +
    'judged it. Audit their work in two passes: (1) rubric quality — are the ' +
    'criteria specific, verifiable, non-overlapping, unambiguous, hard to game, ' +
    'and complete for this prompt; (2) judgement correctness — independently ' +
    'apply their rubric to the response and check whether their pass/fail calls ' +
    'are right. A wrong judgement is more serious than a weak rubric.',
  dimensions: [
    {
      id: 'rubric_quality',
      name: 'Rubric quality',
      description:
        'Quality of the criteria the labeler authored: specific, objectively ' +
        'verifiable, non-overlapping, unambiguous, hard to game, and together ' +
        'covering what matters for this prompt.',
      weight: 40,
      anchors: {
        excellent:
          '90-100: criteria are specific, verifiable, non-overlapping, and cover the prompt well.',
        acceptable:
          '50-89: usable rubric with some vague, overlapping, or missing criteria.',
        failing:
          '0-49: vague, gameable, redundant, or major coverage gaps.',
      },
    },
    {
      id: 'judgment_correctness',
      name: 'Judgment correctness',
      description:
        "Agreement between the agent's INDEPENDENT application of the labeler's " +
        "rubric to the response and the labeler's recorded pass/fail verdict.",
      weight: 60,
      anchors: {
        excellent:
          '90-100: the labeler\'s per-criterion and overall calls match an independent application of their rubric.',
        acceptable:
          '50-89: minor disagreement on a non-material criterion only.',
        failing:
          '0-49: the labeler\'s pass/fail is wrong on a material criterion or overall.',
      },
    },
  ],
  passAt: 70,
  sendBackAt: 40,
  tier: 'fast',
  samples: 1,
  taskKind: 'rubric_judgment',
}
