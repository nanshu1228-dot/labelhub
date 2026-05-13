import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Provider-resolution tests for `chat()`.
 *
 * We don't hit any real provider here — the goal is verifying the env →
 * provider routing logic. The actual HTTP calls are tested separately
 * (manual smoke against Doubao; they don't belong in a unit suite).
 */

// Capture + restore env across tests since the module caches its first read.
const ORIGINAL = process.env

beforeEach(() => {
  process.env = { ...ORIGINAL }
  // Reset module state — the client memoizes resolveDefaultProvider so we
  // must re-import to get a fresh closure each test.
  vi.resetModules()
})

afterEach(() => {
  process.env = ORIGINAL
})

describe('resolveDefaultProvider — explicit AI_DEFAULT_PROVIDER', () => {
  it('uses the explicit provider when its key is set', async () => {
    process.env.AI_DEFAULT_PROVIDER = 'doubao'
    process.env.DOUBAO_API_KEY = 'sk-doubao-fake'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake'
    const { resolveDefaultProvider } = await import('./client')
    expect(resolveDefaultProvider()).toBe('doubao')
  })

  it('throws when explicit provider has no key', async () => {
    process.env.AI_DEFAULT_PROVIDER = 'qwen'
    delete process.env.QWEN_API_KEY
    process.env.DOUBAO_API_KEY = 'sk-doubao-fake'
    const { resolveDefaultProvider } = await import('./client')
    expect(() => resolveDefaultProvider()).toThrow(/QWEN_API_KEY is not set/)
  })

  it('ignores unrecognized AI_DEFAULT_PROVIDER and falls through to auto-detect', async () => {
    process.env.AI_DEFAULT_PROVIDER = 'mistral' // not in our enum
    process.env.DOUBAO_API_KEY = 'sk-doubao-fake'
    const { resolveDefaultProvider } = await import('./client')
    expect(resolveDefaultProvider()).toBe('doubao')
  })
})

describe('resolveDefaultProvider — auto-detect when no explicit choice', () => {
  it('prefers anthropic when its key is set', async () => {
    delete process.env.AI_DEFAULT_PROVIDER
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake'
    process.env.DOUBAO_API_KEY = 'sk-doubao-fake'
    const { resolveDefaultProvider } = await import('./client')
    expect(resolveDefaultProvider()).toBe('anthropic')
  })

  it('falls through to doubao when anthropic is empty-string (treated as unset)', async () => {
    delete process.env.AI_DEFAULT_PROVIDER
    process.env.ANTHROPIC_API_KEY = ''
    process.env.DOUBAO_API_KEY = 'sk-doubao-fake'
    const { resolveDefaultProvider } = await import('./client')
    expect(resolveDefaultProvider()).toBe('doubao')
  })

  it('falls through to doubao when anthropic is whitespace-only', async () => {
    delete process.env.AI_DEFAULT_PROVIDER
    process.env.ANTHROPIC_API_KEY = '   '
    process.env.DOUBAO_API_KEY = 'sk-doubao-fake'
    const { resolveDefaultProvider } = await import('./client')
    expect(resolveDefaultProvider()).toBe('doubao')
  })

  it('throws when no provider is configured', async () => {
    delete process.env.AI_DEFAULT_PROVIDER
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.DOUBAO_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    delete process.env.MOONSHOT_API_KEY
    delete process.env.QWEN_API_KEY
    delete process.env.OPENAI_API_KEY
    const { resolveDefaultProvider } = await import('./client')
    expect(() => resolveDefaultProvider()).toThrow(/No AI provider configured/)
  })

  it('follows the documented order: anthropic > doubao > deepseek > moonshot > qwen > openai', async () => {
    delete process.env.AI_DEFAULT_PROVIDER
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.DOUBAO_API_KEY
    process.env.DEEPSEEK_API_KEY = 'sk-ds-fake'
    process.env.OPENAI_API_KEY = 'sk-oai-fake'
    const { resolveDefaultProvider } = await import('./client')
    expect(resolveDefaultProvider()).toBe('deepseek')
  })
})

describe('model tier resolution', () => {
  it('uses per-provider tier ladders by default', async () => {
    process.env.AI_DEFAULT_PROVIDER = 'doubao'
    process.env.DOUBAO_API_KEY = 'sk-fake'
    delete process.env.DOUBAO_MODEL_DEFAULT
    const { chat } = await import('./client')
    // Spy on global fetch and inspect the request body to see which model
    // the dispatcher chose.
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
      )
    await chat({ system: 'hi', messages: [{ role: 'user', content: 'x' }], maxTokens: 50 })
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))
    expect(body.model).toContain('doubao-')
    fetchSpy.mockRestore()
  })

  it('honors the per-provider per-tier model override env var', async () => {
    process.env.AI_DEFAULT_PROVIDER = 'doubao'
    process.env.DOUBAO_API_KEY = 'sk-fake'
    process.env.DOUBAO_MODEL_DEFAULT = 'doubao-1-5-pro-256k-fake'
    const { chat } = await import('./client')
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
      )
    await chat({ system: 'hi', messages: [{ role: 'user', content: 'x' }], maxTokens: 50 })
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))
    expect(body.model).toBe('doubao-1-5-pro-256k-fake')
    fetchSpy.mockRestore()
  })
})

describe('openai-compat request shape', () => {
  beforeEach(() => {
    process.env.AI_DEFAULT_PROVIDER = 'doubao'
    process.env.DOUBAO_API_KEY = 'sk-fake'
  })

  it('puts system as messages[0] in openai-compat shape', async () => {
    const { chat } = await import('./client')
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
      )
    await chat({
      system: 'You are a labeler.',
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 50,
    })
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a labeler.' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Hi' })
    fetchSpy.mockRestore()
  })

  it('passes json_object response_format when requested', async () => {
    const { chat } = await import('./client')
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{}' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
      )
    await chat({
      system: 'json please',
      messages: [{ role: 'user', content: 'x' }],
      maxTokens: 50,
      responseFormat: 'json_object',
    })
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))
    expect(body.response_format).toEqual({ type: 'json_object' })
    fetchSpy.mockRestore()
  })

  it('omits response_format when not requested', async () => {
    const { chat } = await import('./client')
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
      )
    await chat({ system: 'hi', messages: [{ role: 'user', content: 'x' }], maxTokens: 50 })
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))
    expect('response_format' in body).toBe(false)
    fetchSpy.mockRestore()
  })

  it('reports usage from prompt_tokens / completion_tokens', async () => {
    const { chat } = await import('./client')
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'doubao-1-5-pro-32k-fake',
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 123, completion_tokens: 45 },
        }),
        { status: 200 },
      ),
    )
    const out = await chat({
      system: 'hi',
      messages: [{ role: 'user', content: 'x' }],
      maxTokens: 50,
    })
    expect(out.usage.inputTokens).toBe(123)
    expect(out.usage.outputTokens).toBe(45)
    expect(out.usage.provider).toBe('doubao')
    expect(out.usage.model).toBe('doubao-1-5-pro-32k-fake')
  })

  it('surfaces non-2xx upstream errors with status + body excerpt', async () => {
    const { chat } = await import('./client')
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('{"error":"rate limited"}', { status: 429, statusText: 'Too Many Requests' }),
    )
    await expect(
      chat({ system: 'hi', messages: [{ role: 'user', content: 'x' }], maxTokens: 50 }),
    ).rejects.toThrow(/429.*Too Many Requests.*rate limited/)
  })
})
