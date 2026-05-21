import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/guards', () => ({
  requireUser: vi.fn(),
}))
vi.mock('@/lib/ai/client', () => ({
  chat: vi.fn(),
}))
vi.mock('@/lib/ai/quota', () => ({
  assertWithinDailyAIQuota: vi.fn().mockResolvedValue(undefined),
  logAICall: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/ratelimit/public-endpoint', () => ({
  rateLimitPublic: vi.fn(),
  callerIp: vi.fn(() => 'unknown'),
}))

import { POST } from './route'
import { requireUser } from '@/lib/auth/guards'
import { chat } from '@/lib/ai/client'
import {
  assertWithinDailyAIQuota,
  logAICall,
} from '@/lib/ai/quota'
import { rateLimitPublic } from '@/lib/ratelimit/public-endpoint'
import { QuotaExceededError } from '@/lib/errors'

/**
 * /api/llm-assist policy tests — Finals P2 D10.
 *
 * The route is the Labeler-side AI assist endpoint that the form
 * Renderer's `llm-trigger` material calls. These tests cover the
 * gates the route applies BEFORE the LLM call:
 *
 *   1. Auth: signed-in user required (401 otherwise)
 *   2. Rate limit: 10/min per user (429 + Retry-After otherwise)
 *   3. Body validation: Zod-validated; 400 on malformed input
 *   4. Quota: assertWithinDailyAIQuota (429 on QuotaExceededError)
 *   5. Body size cap: 413 on >32KB
 *
 * Plus the happy path that the response shape matches what the
 * Renderer expects.
 */

const USER = { id: 'u-1', email: 'u@labelhub.dev' }

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/llm-assist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(rateLimitPublic).mockReturnValue({
    ok: true,
    remaining: 9,
    retryAfter: 0,
  })
  vi.mocked(requireUser).mockResolvedValue(USER as never)
})

describe('POST /api/llm-assist — auth + rate limit', () => {
  it('returns 401 when requireUser throws', async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(
      new Error('Sign in to continue.'),
    )
    const res = await POST(
      makeReq({ promptTemplate: 'Be helpful.', context: {} }),
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/sign in/i)
  })

  it('returns 429 with Retry-After when rate-limited', async () => {
    vi.mocked(rateLimitPublic).mockReturnValueOnce({
      ok: false,
      remaining: 0,
      retryAfter: 42,
    })
    const res = await POST(
      makeReq({ promptTemplate: 'Be helpful.', context: {} }),
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    const body = await res.json()
    expect(body.error).toMatch(/rate limit/i)
    expect(body.retryAfter).toBe(42)
  })

  it('uses the user id as the rate-limit key', async () => {
    vi.mocked(chat).mockResolvedValueOnce({
      text: 'ok',
      usage: {
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 1,
        outputTokens: 1,
        provider: 'anthropic',
      },
    } as never)
    await POST(
      makeReq({ promptTemplate: 'Be helpful.', context: {} }),
    )
    expect(vi.mocked(rateLimitPublic)).toHaveBeenCalledWith(
      `user:${USER.id}`,
      10,
    )
  })
})

describe('POST /api/llm-assist — body validation', () => {
  it('returns 400 on invalid JSON', async () => {
    const res = await POST(
      makeReq('not-json{{{') as Request,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid json/i)
  })

  it('returns 400 on missing promptTemplate', async () => {
    const res = await POST(makeReq({ context: {} }))
    expect(res.status).toBe(400)
  })

  it('returns 413 when body exceeds the size cap', async () => {
    const huge = 'x'.repeat(40_000)
    const res = await POST(
      makeReq({ promptTemplate: huge, context: {} }),
    )
    expect(res.status).toBe(413)
  })
})

describe('POST /api/llm-assist — quota', () => {
  it('returns 429 when daily quota is exceeded', async () => {
    vi.mocked(assertWithinDailyAIQuota).mockRejectedValueOnce(
      new QuotaExceededError('Daily AI quota reached (100/100).'),
    )
    const res = await POST(
      makeReq({ promptTemplate: 'Be helpful.', context: {} }),
    )
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toMatch(/quota/i)
  })
})

describe('POST /api/llm-assist — happy path', () => {
  it('returns the model text + usage metadata', async () => {
    vi.mocked(chat).mockResolvedValueOnce({
      text: 'The answer is 42.',
      usage: {
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 24,
        outputTokens: 6,
        provider: 'anthropic',
      },
    } as never)
    const res = await POST(
      makeReq({
        promptTemplate: 'Suggest a short answer.',
        context: { previous: 'thinking' },
        tier: 'fast',
        itemData: { prompt: 'What is the meaning?' },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.text).toBe('The answer is 42.')
    expect(body.usage.model).toBe('claude-haiku-4-5-20251001')
    expect(body.usage.outputTokens).toBe(6)
    // Cost log fired with the right shape.
    expect(vi.mocked(logAICall)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        feature: 'llm-assist',
      }),
    )
  })

  it('returns 502 when the LLM call throws', async () => {
    vi.mocked(chat).mockRejectedValueOnce(new Error('upstream down'))
    const res = await POST(
      makeReq({ promptTemplate: 'X', context: {} }),
    )
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/upstream down/i)
  })

  it('passes the configured tier to chat()', async () => {
    vi.mocked(chat).mockResolvedValueOnce({
      text: 'ok',
      usage: {
        model: 'claude-sonnet-4-6',
        inputTokens: 1,
        outputTokens: 1,
        provider: 'anthropic',
      },
    } as never)
    await POST(
      makeReq({
        promptTemplate: 'X',
        context: {},
        tier: 'default',
      }),
    )
    const call = vi.mocked(chat).mock.calls[0]?.[0]
    expect(call?.tier).toBe('default')
    expect(call?.responseFormat).toBe('text')
    expect(call?.cacheSystem).toBe(true)
    expect(call?.feature).toBe('llm-assist')
  })
})
