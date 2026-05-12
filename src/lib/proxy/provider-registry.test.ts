import { describe, expect, it } from 'vitest'
import {
  PROVIDERS,
  buildUpstreamHeaders,
  getProviderDef,
  listProviders,
} from './provider-registry'

describe('provider-registry', () => {
  it('exposes at least 6 OOTB providers', () => {
    const all = listProviders()
    expect(all.length).toBeGreaterThanOrEqual(6)
    const kinds = all.map((p) => p.kind).sort()
    expect(kinds).toContain('doubao')
    expect(kinds).toContain('anthropic')
    expect(kinds).toContain('openai')
    expect(kinds).toContain('deepseek')
    expect(kinds).toContain('qwen')
    expect(kinds).toContain('moonshot')
  })

  it('every registered provider has the required fields', () => {
    for (const p of listProviders()) {
      expect(p.kind).toBeTypeOf('string')
      expect(p.label).toBeTypeOf('string')
      expect(p.defaultBaseUrl).toMatch(/^https?:\/\//)
      expect(['openai-compat', 'anthropic']).toContain(p.family)
      expect(['authorization-bearer', 'x-api-key']).toContain(p.apiHeader)
      expect(p.upstreamPath.startsWith('/')).toBe(true)
      expect(p.envFallback).toMatch(/_API_KEY$/)
    }
  })

  it('returns null for unknown providers', () => {
    expect(getProviderDef('llama-via-vllm')).toBeNull()
    expect(getProviderDef('')).toBeNull()
  })

  it('buildUpstreamHeaders for OpenAI-compat sets Bearer + content-type', () => {
    const def = PROVIDERS.doubao
    const h = buildUpstreamHeaders(def, 'ark-foo')
    expect(h['Content-Type']).toBe('application/json')
    expect(h['Authorization']).toBe('Bearer ark-foo')
    expect(h['x-api-key']).toBeUndefined()
  })

  it('buildUpstreamHeaders for Anthropic uses x-api-key + version header', () => {
    const def = PROVIDERS.anthropic
    const h = buildUpstreamHeaders(def, 'sk-ant-xxx')
    expect(h['x-api-key']).toBe('sk-ant-xxx')
    expect(h['anthropic-version']).toBe('2023-06-01')
    expect(h['Authorization']).toBeUndefined()
  })

  it('forwards anthropic-version and anthropic-beta when present on the client request', () => {
    const def = PROVIDERS.anthropic
    const clientHeaders = new Headers({
      'anthropic-version': '2025-09-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    })
    const h = buildUpstreamHeaders(def, 'sk-ant', clientHeaders)
    expect(h['anthropic-version']).toBe('2025-09-01')
    expect(h['anthropic-beta']).toBe('prompt-caching-2024-07-31')
  })

  it('does NOT forward anthropic-* headers for non-anthropic providers', () => {
    const def = PROVIDERS.doubao
    const clientHeaders = new Headers({
      'anthropic-version': '2025-09-01',
      'anthropic-beta': 'experimental',
    })
    const h = buildUpstreamHeaders(def, 'ark', clientHeaders)
    expect(h['anthropic-version']).toBeUndefined()
    expect(h['anthropic-beta']).toBeUndefined()
  })
})
