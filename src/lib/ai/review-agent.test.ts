import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client', () => ({
  chat: vi.fn(),
}))

import {
  runReviewAgent,
  runReviewAgentWithRetry,
  runReviewAgentSelfConsistent,
  weightedOverallScore,
  verdictResponseSchema,
  VERDICT_TOOL,
  extractRubricJudgmentContext,
} from './review-agent'
import { chat } from './client'

/**
 * AI Review Agent — unit tests (Finals P2 D8).
 *
 * The agent itself is pure once you mock `chat()`. The scheduler-side
 * integration (quota + verdict persistence) lives in
 * `ai-review-submission.test.ts`; here we cover:
 *
 *   - happy path: valid model output round-trips through Zod
 *   - non-JSON output: throws with a readable message
 *   - Zod-invalid output: surfaces the parse error
 *   - threshold enforcement: if the model picks the wrong verdict
 *     for its score, the agent overrides to match the thresholds
 *   - threshold validity: sendBackAt < passAt is enforced upfront
 *   - retry: a transient failure followed by success returns ok
 *   - retry exhaustion: throws the last error after N attempts
 */

const BASE_INPUT = {
  promptTemplate: 'Be strict but fair.',
  dimensions: [
    { id: 'completeness', name: 'Completeness' },
    { id: 'accuracy', name: 'Accuracy' },
  ],
  submissionJson: JSON.stringify({ answer: 'A is correct because…' }),
}

function chatOk(text: string) {
  return {
    text,
    usage: {
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 120,
      outputTokens: 80,
      provider: 'anthropic',
    },
  }
}

/** Primary path: the model called the submit_verdict tool. */
function chatToolOk(input: unknown) {
  return {
    text: '',
    toolUse: { name: 'submit_verdict', input },
    usage: {
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 120,
      outputTokens: 80,
      provider: 'anthropic',
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runReviewAgent — happy path', () => {
  it('parses a valid JSON verdict', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatOk(
        JSON.stringify({
          verdict: 'pass',
          score: 88,
          dimensions: { completeness: 90, accuracy: 86 },
          reasoning: 'Submission is thorough and factually accurate.',
        }),
      ) as never,
    )
    const r = await runReviewAgent(BASE_INPUT)
    expect(r.payload.verdict).toBe('pass')
    expect(r.payload.score).toBe(88)
    // Bare-number dimensions normalize to the {score,reasoning,evidence} shape.
    expect(r.payload.dimensions.completeness.score).toBe(90)
    expect(r.usage.model).toBe('claude-haiku-4-5-20251001')
    expect(r.promptTrace.system).toContain('reviewer')
    expect(r.promptTrace.user).toContain('<owner_prompt>')
    expect(r.promptTrace.user).toContain('<submission>')
  })

  it('uses the submit_verdict tool-call arguments (primary Function-Calling path)', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatToolOk({
        verdict: 'pass',
        score: 91,
        dimensions: { completeness: 92, accuracy: 90 },
        reasoning: 'Structured tool output, no text parsing needed.',
      }) as never,
    )
    const r = await runReviewAgent(BASE_INPUT)
    expect(r.payload.verdict).toBe('pass')
    expect(r.payload.score).toBe(91)
    expect(r.payload.dimensions.completeness.score).toBe(92)
  })

  it('preserves per-dimension reasoning + evidence (explainability)', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatToolOk({
        verdict: 'pass',
        score: 88,
        dimensions: {
          accuracy: {
            score: 86,
            reasoning: 'States the capital correctly.',
            evidence: ['answer: "Paris is the capital of France"'],
          },
        },
        reasoning: 'Accurate and complete.',
        evidence: ['overall well-formed'],
      }) as never,
    )
    const r = await runReviewAgent(BASE_INPUT)
    expect(r.payload.dimensions.accuracy.score).toBe(86)
    expect(r.payload.dimensions.accuracy.reasoning).toContain('capital')
    expect(r.payload.dimensions.accuracy.evidence[0]).toContain('Paris')
    expect(r.payload.evidence[0]).toContain('well-formed')
  })

  it('forces a reason-then-decide tool layout (analysis first, verdict last)', async () => {
    // The tool schema property order IS the reasoning workflow: under forced
    // tool-use the model fills keys top-to-bottom, so analysis precedes the
    // verdict (reason first, decide last — not decide-then-justify).
    const props = Object.keys(VERDICT_TOOL.inputSchema.properties ?? {})
    expect(props[0]).toBe('analysis')
    expect(props.indexOf('analysis')).toBeLessThan(props.indexOf('score'))
    expect(props.indexOf('score')).toBeLessThan(props.indexOf('verdict'))
    expect(VERDICT_TOOL.inputSchema.required?.[0]).toBe('analysis')
    // Per-dimension: reasoning is required before the score.
    const dimProps = (
      VERDICT_TOOL.inputSchema.properties?.dimensions as {
        additionalProperties?: { properties?: Record<string, unknown>; required?: string[] }
      }
    )?.additionalProperties
    expect(Object.keys(dimProps?.properties ?? {})[0]).toBe('reasoning')
    expect(dimProps?.required).toContain('reasoning')
  })

  it('adds a pairwise / position-bias frame for preference_compare tasks', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatToolOk({ verdict: 'pass', score: 80, dimensions: {}, reasoning: 'ok' }) as never,
    )
    const r = await runReviewAgent({ ...BASE_INPUT, taskKind: 'preference_compare' })
    expect(r.promptTrace.user).toContain('<task_kind>preference_compare</task_kind>')
    expect(r.promptTrace.user).toMatch(/PAIRWISE|position bias/i)
  })

  it('runs greedy/deterministic (temperature 0) for a single sample', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatToolOk({
        verdict: 'pass',
        score: 80,
        dimensions: {},
        reasoning: 'ok',
      }) as never,
    )
    const r = await runReviewAgent(BASE_INPUT)
    expect(vi.mocked(chat).mock.calls[0]?.[0]?.temperature).toBe(0)
    expect(r.usage.temperature).toBe(0)
    expect(r.usage.provider).toBe('anthropic')
  })

  it('strips code fences before JSON.parse', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatOk(
        '```json\n' +
          JSON.stringify({
            verdict: 'send_back',
            score: 22,
            dimensions: { accuracy: 30 },
            reasoning: 'Needs more detail.',
          }) +
          '\n```',
      ) as never,
    )
    const r = await runReviewAgent(BASE_INPUT)
    expect(r.payload.verdict).toBe('send_back')
  })

  it('forces the submit_verdict tool + keeps the json_object fallback hint', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatToolOk({
        verdict: 'pass',
        score: 75,
        dimensions: {},
        reasoning: 'ok',
      }) as never,
    )
    await runReviewAgent(BASE_INPUT)
    const lastCall = vi.mocked(chat).mock.calls[0]?.[0]
    // Spec 4.4 Function Calling: the tool is supplied AND forced.
    expect(lastCall?.tools?.[0]?.name).toBe('submit_verdict')
    expect(lastCall?.tools?.[0]?.inputSchema?.type).toBe('object')
    expect(lastCall?.toolChoice).toEqual({ type: 'tool', name: 'submit_verdict' })
    // Fallback hint + caching/attribution preserved.
    expect(lastCall?.responseFormat).toBe('json_object')
    expect(lastCall?.cacheSystem).toBe(true)
    expect(lastCall?.feature).toBe('ai-review-agent')
  })
})

describe('runReviewAgent — error paths', () => {
  it('throws on non-JSON output', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatOk('I am a model and I refuse to JSON.') as never,
    )
    await expect(runReviewAgent(BASE_INPUT)).rejects.toThrow(/neither.*tool call nor JSON/)
  })

  it('throws on Zod-invalid output (missing reasoning)', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatOk(
        JSON.stringify({
          verdict: 'pass',
          score: 88,
          dimensions: {},
          // no reasoning
        }),
      ) as never,
    )
    await expect(runReviewAgent(BASE_INPUT)).rejects.toThrow()
  })

  it('throws on Zod-invalid score (out of 0-100)', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatOk(
        JSON.stringify({
          verdict: 'pass',
          score: 999,
          dimensions: {},
          reasoning: 'too high',
        }),
      ) as never,
    )
    await expect(runReviewAgent(BASE_INPUT)).rejects.toThrow()
  })

  it('throws when sendBackAt >= passAt before any chat call', async () => {
    await expect(
      runReviewAgent({ ...BASE_INPUT, sendBackAt: 70, passAt: 70 }),
    ).rejects.toThrow(/thresholds invalid/)
    expect(vi.mocked(chat)).not.toHaveBeenCalled()
  })
})

describe('runReviewAgent — threshold enforcement', () => {
  it('overrides verdict when the model contradicts its own score (low)', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatOk(
        JSON.stringify({
          verdict: 'pass', // contradicts score=20
          score: 20,
          dimensions: { completeness: 10 },
          reasoning: 'Despite low score model said pass.',
        }),
      ) as never,
    )
    const r = await runReviewAgent({ ...BASE_INPUT, passAt: 70, sendBackAt: 40 })
    expect(r.payload.verdict).toBe('send_back')
  })

  it('overrides verdict when the model contradicts its own score (high)', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatOk(
        JSON.stringify({
          verdict: 'send_back', // contradicts score=92
          score: 92,
          dimensions: { completeness: 95 },
          reasoning: 'Model picked the wrong polarity.',
        }),
      ) as never,
    )
    const r = await runReviewAgent({ ...BASE_INPUT, passAt: 70, sendBackAt: 40 })
    expect(r.payload.verdict).toBe('pass')
  })

  it('lands on human_review for mid scores', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatOk(
        JSON.stringify({
          verdict: 'pass',
          score: 55,
          dimensions: { completeness: 55 },
          reasoning: 'Borderline.',
        }),
      ) as never,
    )
    const r = await runReviewAgent({ ...BASE_INPUT, passAt: 70, sendBackAt: 40 })
    expect(r.payload.verdict).toBe('human_review')
  })
})

describe('runReviewAgentWithRetry', () => {
  it('returns on first success without sleeping', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatOk(
        JSON.stringify({
          verdict: 'pass',
          score: 90,
          dimensions: {},
          reasoning: 'ok',
        }),
      ) as never,
    )
    const r = await runReviewAgentWithRetry(BASE_INPUT)
    expect(r.payload.verdict).toBe('pass')
    expect(r.attemptsUsed).toBe(1)
    expect(vi.mocked(chat)).toHaveBeenCalledTimes(1)
  })

  it('retries once on transient failure then succeeds', async () => {
    vi.mocked(chat)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(
        chatOk(
          JSON.stringify({
            verdict: 'pass',
            score: 90,
            dimensions: {},
            reasoning: 'ok',
          }),
        ) as never,
    )
    const r = await runReviewAgentWithRetry(BASE_INPUT, 3, 1)
    expect(r.payload.verdict).toBe('pass')
    expect(r.attemptsUsed).toBe(2)
    expect(vi.mocked(chat)).toHaveBeenCalledTimes(2)
  })

  it('throws after N attempts exhaust', async () => {
    vi.mocked(chat).mockRejectedValue(new Error('always broken'))
    await expect(
      runReviewAgentWithRetry(BASE_INPUT, 3, 1),
    ).rejects.toThrow(/always broken/)
    expect(vi.mocked(chat)).toHaveBeenCalledTimes(3)
  })
})

describe('weighted dimension aggregation', () => {
  it('recomputes the overall from dimension weights, overriding the model score', async () => {
    // Model claims overall 90, but accuracy (weight 100) scored only 30 →
    // the deterministic weighted overall is 30 → verdict flips to send_back.
    vi.mocked(chat).mockResolvedValueOnce(
      chatToolOk({
        verdict: 'pass',
        score: 90,
        dimensions: { accuracy: { score: 30, reasoning: 'wrong', evidence: [] } },
        reasoning: 'Model over-scored itself.',
      }) as never,
    )
    const r = await runReviewAgent({
      ...BASE_INPUT,
      dimensions: [{ id: 'accuracy', name: 'Accuracy', weight: 100 }],
      passAt: 70,
      sendBackAt: 40,
    })
    expect(r.payload.score).toBe(30)
    expect(r.payload.verdict).toBe('send_back')
  })

  it('weightedOverallScore returns null when no dimension is weighted', () => {
    expect(
      weightedOverallScore(
        [{ id: 'a', name: 'A' }],
        { a: { score: 50 } },
      ),
    ).toBeNull()
  })

  it('weightedOverallScore computes a weighted average', () => {
    expect(
      weightedOverallScore(
        [
          { id: 'a', name: 'A', weight: 75 },
          { id: 'b', name: 'B', weight: 25 },
        ],
        { a: { score: 100 }, b: { score: 0 } },
      ),
    ).toBe(75)
  })
})

describe('runReviewAgentSelfConsistent', () => {
  it('delegates to the single-shot path when samples <= 1', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatToolOk({ verdict: 'pass', score: 90, dimensions: {}, reasoning: 'ok' }) as never,
    )
    const r = await runReviewAgentSelfConsistent(BASE_INPUT, 1)
    expect(r.payload.verdict).toBe('pass')
    expect(r.consistency).toBeUndefined()
    expect(vi.mocked(chat)).toHaveBeenCalledTimes(1)
  })

  it('aggregates N samples by median score + majority verdict with a confidence', async () => {
    // 3 samples: scores 90/85/30 → verdicts pass/pass/send_back (passAt 70).
    // median score = 85, majority = pass (2/3 agreement).
    vi.mocked(chat)
      .mockResolvedValueOnce(
        chatToolOk({ verdict: 'pass', score: 90, dimensions: { a: 88 }, reasoning: 'strong' }) as never,
      )
      .mockResolvedValueOnce(
        chatToolOk({ verdict: 'pass', score: 85, dimensions: { a: 82 }, reasoning: 'good' }) as never,
      )
      .mockResolvedValueOnce(
        chatToolOk({ verdict: 'send_back', score: 30, dimensions: { a: 28 }, reasoning: 'weak' }) as never,
      )
    const r = await runReviewAgentSelfConsistent(
      { ...BASE_INPUT, passAt: 70, sendBackAt: 40 },
      3,
    )
    expect(vi.mocked(chat)).toHaveBeenCalledTimes(3)
    expect(r.payload.verdict).toBe('pass')
    expect(r.payload.score).toBe(85)
    expect(r.consistency?.samples).toBe(3)
    expect(r.consistency?.agreement).toBeCloseTo(2 / 3, 5)
    expect(r.consistency?.confidence).toBeGreaterThan(0)
    expect(r.consistency?.sampleScores.sort((a, b) => a - b)).toEqual([30, 85, 90])
    // Each sample runs at a non-zero temperature so they vary.
    expect(vi.mocked(chat).mock.calls[0]?.[0]?.temperature).toBeGreaterThan(0)
  })

  it('escalates to human_review on a verdict tie', async () => {
    // 2 samples disagree (pass vs send_back) → tie → human_review.
    vi.mocked(chat)
      .mockResolvedValueOnce(
        chatToolOk({ verdict: 'pass', score: 90, dimensions: {}, reasoning: 'a' }) as never,
      )
      .mockResolvedValueOnce(
        chatToolOk({ verdict: 'send_back', score: 20, dimensions: {}, reasoning: 'b' }) as never,
      )
    const r = await runReviewAgentSelfConsistent(
      { ...BASE_INPUT, passAt: 70, sendBackAt: 40 },
      2,
    )
    expect(r.payload.verdict).toBe('human_review')
  })
})

describe('verdictResponseSchema (Zod)', () => {
  it('accepts a minimal valid payload', () => {
    const r = verdictResponseSchema.safeParse({
      verdict: 'pass',
      score: 80,
      dimensions: {},
      reasoning: 'looks good',
    })
    expect(r.success).toBe(true)
  })

  it('defaults `dimensions` to an empty object when omitted', () => {
    const r = verdictResponseSchema.safeParse({
      verdict: 'pass',
      score: 80,
      reasoning: 'looks good',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.dimensions).toEqual({})
  })

  it('rejects bogus verdict labels', () => {
    const r = verdictResponseSchema.safeParse({
      verdict: 'maybe',
      score: 50,
      dimensions: {},
      reasoning: 'huh',
    })
    expect(r.success).toBe(false)
  })
})

/**
 * rubric_judgment task kind — rubric-authoring + judgement meta-review.
 *
 * Three concerns mirror the frozen contract:
 *   - extractRubricJudgmentContext pulls the response / authored rubric /
 *     labeler verdict out of the raw annotation payload + topic itemData
 *   - runReviewAgent surfaces them as DISTINCT labelled sections in the
 *     user prompt, with the rubric-authoring + judgement kindClause
 *   - the criticalDimension floor caps a 'pass' when judgment_correctness
 *     is below the floor, even if the weighted overall would pass
 */
describe('extractRubricJudgmentContext', () => {
  it('splits the annotation payload + itemData into the three meta-review inputs', () => {
    const ctx = extractRubricJudgmentContext(
      {
        rubricItems: [{ id: 'r1', name: 'Cites source' }],
        judgments: { r1: 'pass' },
        overallVerdict: 'pass',
        notes: 'ok',
      },
      { prompt: 'Q', response: { modelName: 'm', content: 'A' } },
    )
    // The pre-generated response is the thing being judged — model name + body.
    expect(ctx.modelResponse).toContain('A')
    expect(ctx.modelResponse).toContain('[m]')
    expect(ctx.prompt).toBe('Q')
    // The labeler-authored rubric round-trips.
    expect(ctx.rubricItems).toHaveLength(1)
    expect(ctx.rubricItems[0]).toMatchObject({ id: 'r1', name: 'Cites source' })
    // The labeler's recorded judgement: overall + per-criterion + notes.
    expect(ctx.annotatorVerdict.overall).toBe('pass')
    expect(ctx.annotatorVerdict.perItem?.r1).toBe('pass')
    expect(ctx.annotatorVerdict.notes).toBe('ok')
  })
})

describe('runReviewAgent — rubric_judgment prompt sections', () => {
  it('emits the response / rubric / verdict sections + the authoring+judgement clause', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatToolOk({
        verdict: 'pass',
        score: 88,
        dimensions: {
          rubric_quality: { score: 90, reasoning: 'tight criteria', evidence: [] },
          judgment_correctness: { score: 88, reasoning: 'matches', evidence: [] },
        },
        reasoning: 'Good rubric, correct call.',
      }) as never,
    )
    const r = await runReviewAgent({
      ...BASE_INPUT,
      taskKind: 'rubric_judgment',
      dimensions: [
        { id: 'rubric_quality', name: 'Rubric quality' },
        { id: 'judgment_correctness', name: 'Judgment correctness' },
      ],
      rubricJudgment: {
        modelResponse: '[m]\nParis is the capital of France.',
        prompt: 'What is the capital of France?',
        rubricItems: [{ id: 'r1', name: 'Names the city' }],
        annotatorVerdict: { overall: 'pass', perItem: { r1: 'pass' }, notes: 'fine' },
      },
    })
    const user = r.promptTrace.user
    // The split-out sections the agent reasons over.
    expect(user).toContain('<task_kind>rubric_judgment</task_kind>')
    expect(user).toContain('<model_response>')
    expect(user).toContain('<annotator_rubric>')
    expect(user).toContain('<annotator_verdict>')
    // The rubric-authoring + judgement meta-review framing.
    expect(user).toContain('RUBRIC AUTHORING + JUDGEMENT')
    expect(user).toMatch(/RUBRIC QUALITY/)
    expect(user).toMatch(/JUDGEMENT CORRECTNESS/)
    expect(r.payload.verdict).toBe('pass')
  })
})

describe('runReviewAgent — criticalDimension floor (rubric_judgment)', () => {
  const RJ_DIMENSIONS = [
    { id: 'rubric_quality', name: 'Rubric quality', weight: 40 },
    { id: 'judgment_correctness', name: 'Judgment correctness', weight: 60 },
  ]

  it('downgrades a passing weighted score to human_review when judgment_correctness is below the floor', async () => {
    // rubric_quality 95 (w40) + judgment_correctness 60 (w60) →
    // weighted = (95*40 + 60*60) / 100 = 74 ≥ passAt(70) → would be 'pass',
    // BUT judgment_correctness 60 < floor 70 → critical floor caps it.
    vi.mocked(chat).mockResolvedValueOnce(
      chatToolOk({
        verdict: 'pass',
        score: 74,
        dimensions: {
          rubric_quality: { score: 95, reasoning: 'great rubric', evidence: [] },
          judgment_correctness: { score: 60, reasoning: 'wrong call', evidence: [] },
        },
        reasoning: 'Great rubric but the labeler judged it wrong.',
      }) as never,
    )
    const r = await runReviewAgent({
      ...BASE_INPUT,
      taskKind: 'rubric_judgment',
      dimensions: RJ_DIMENSIONS,
      passAt: 70,
      sendBackAt: 40,
      criticalDimension: {
        id: 'judgment_correctness',
        floor: 70,
        downgradeTo: 'human_review',
      },
    })
    // Weighted overall is 74 (≥ passAt) so by score alone it would pass…
    expect(r.payload.score).toBe(74)
    // …but the critical-dimension floor overrides 'pass'.
    expect(r.payload.verdict).toBe('human_review')
  })

  it('control: a high judgment_correctness stays pass', async () => {
    // rubric_quality 95 (w40) + judgment_correctness 85 (w60) →
    // weighted = (95*40 + 85*60) / 100 = 89 ≥ passAt(70) → 'pass',
    // and judgment_correctness 85 ≥ floor 70 → floor does NOT fire.
    vi.mocked(chat).mockResolvedValueOnce(
      chatToolOk({
        verdict: 'pass',
        score: 89,
        dimensions: {
          rubric_quality: { score: 95, reasoning: 'great rubric', evidence: [] },
          judgment_correctness: { score: 85, reasoning: 'correct call', evidence: [] },
        },
        reasoning: 'Great rubric and a correct judgement.',
      }) as never,
    )
    const r = await runReviewAgent({
      ...BASE_INPUT,
      taskKind: 'rubric_judgment',
      dimensions: RJ_DIMENSIONS,
      passAt: 70,
      sendBackAt: 40,
      criticalDimension: {
        id: 'judgment_correctness',
        floor: 70,
        downgradeTo: 'human_review',
      },
    })
    expect(r.payload.score).toBe(89)
    expect(r.payload.verdict).toBe('pass')
  })
})
