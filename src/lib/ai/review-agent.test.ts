import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client', () => ({
  chat: vi.fn(),
}))

import {
  runReviewAgent,
  runReviewAgentWithRetry,
  verdictResponseSchema,
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
    expect(r.payload.dimensions.completeness).toBe(90)
    expect(r.usage.model).toBe('claude-haiku-4-5-20251001')
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

  it('passes the json_object response format through to chat()', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      chatOk(
        JSON.stringify({
          verdict: 'pass',
          score: 75,
          dimensions: {},
          reasoning: 'ok',
        }),
      ) as never,
    )
    await runReviewAgent(BASE_INPUT)
    const lastCall = vi.mocked(chat).mock.calls[0]?.[0]
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
    await expect(runReviewAgent(BASE_INPUT)).rejects.toThrow(/non-JSON/)
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
