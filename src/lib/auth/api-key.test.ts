import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { generateApiKey } from './api-key'

describe('API key generation', () => {
  it('plain bearer starts with lh_ws_ prefix', () => {
    const k = generateApiKey()
    expect(k.plain.startsWith('lh_ws_')).toBe(true)
  })

  it('plain bearer is sufficiently long', () => {
    const k = generateApiKey()
    // lh_ws_ (6) + base64url(32 bytes) ~= 43 chars → at least 40
    expect(k.plain.length).toBeGreaterThanOrEqual(40)
  })

  it('hash matches SHA-256 of plain bearer', () => {
    const k = generateApiKey()
    const expected = createHash('sha256').update(k.plain).digest('hex')
    expect(k.hash).toBe(expected)
    expect(k.hash.length).toBe(64) // SHA-256 hex is 64 chars
  })

  it('hash differs from plain (so we know we are not accidentally storing plain)', () => {
    const k = generateApiKey()
    expect(k.hash).not.toBe(k.plain)
  })

  it('different calls produce different keys (CSPRNG)', () => {
    const keys = Array.from({ length: 10 }, () => generateApiKey())
    const plains = new Set(keys.map((k) => k.plain))
    expect(plains.size).toBe(10)
  })

  it('prefix is exactly first 14 chars of plain', () => {
    const k = generateApiKey()
    expect(k.prefix).toBe(k.plain.slice(0, 14))
    expect(k.prefix.startsWith('lh_ws_')).toBe(true)
    expect(k.prefix.length).toBe(14)
  })

  it('plain uses URL-safe base64 (no /, +, =)', () => {
    const k = generateApiKey()
    expect(k.plain).not.toMatch(/[/+=]/)
  })
})
