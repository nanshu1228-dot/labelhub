import { describe, it, expect } from 'vitest'
import { diffPayloads } from './diff-view'

/**
 * Annotation-revision diff tests — Finals P3 D11.
 *
 * The DiffView UI is a thin React shell around `diffPayloads`; the
 * useful unit-level guarantee is that the diff classifies keys
 * correctly and stays JSON-equality-safe for nested values.
 */

describe('diffPayloads — classification', () => {
  it('added when key is in next but not prev', () => {
    const d = diffPayloads({ a: 1 }, { a: 1, b: 'new' })
    expect(d.find((r) => r.key === 'b')?.status).toBe('added')
  })

  it('removed when key is in prev but not next', () => {
    const d = diffPayloads({ a: 1, b: 'gone' }, { a: 1 })
    expect(d.find((r) => r.key === 'b')?.status).toBe('removed')
  })

  it('changed when both present + values differ', () => {
    const d = diffPayloads({ a: 1 }, { a: 2 })
    expect(d.find((r) => r.key === 'a')?.status).toBe('changed')
  })

  it('same when both present + values equal', () => {
    const d = diffPayloads({ a: 1, b: 'x' }, { a: 1, b: 'x' })
    expect(d.every((r) => r.status === 'same')).toBe(true)
  })

  it('deep-equality on nested objects via JSON', () => {
    const d = diffPayloads({ nested: { x: [1, 2] } }, { nested: { x: [1, 2] } })
    expect(d.find((r) => r.key === 'nested')?.status).toBe('same')
  })

  it('detects changed nested objects', () => {
    const d = diffPayloads(
      { nested: { x: [1, 2] } },
      { nested: { x: [1, 2, 3] } },
    )
    expect(d.find((r) => r.key === 'nested')?.status).toBe('changed')
  })

  it('preserves the union of keys regardless of input order', () => {
    const d = diffPayloads({ b: 2, a: 1 }, { a: 1, c: 3 })
    const keys = d.map((r) => r.key).sort()
    expect(keys).toEqual(['a', 'b', 'c'])
  })

  it('classifies null vs missing correctly', () => {
    const d = diffPayloads({ a: null }, { a: null })
    expect(d.find((r) => r.key === 'a')?.status).toBe('same')

    const d2 = diffPayloads({ a: null }, {})
    expect(d2.find((r) => r.key === 'a')?.status).toBe('removed')

    const d3 = diffPayloads({}, { a: null })
    expect(d3.find((r) => r.key === 'a')?.status).toBe('added')
  })

  it('handles empty payloads on both sides', () => {
    expect(diffPayloads({}, {})).toEqual([])
  })

  it('distinguishes number-vs-string under JSON equality', () => {
    const d = diffPayloads({ score: 50 }, { score: '50' })
    expect(d.find((r) => r.key === 'score')?.status).toBe('changed')
  })
})
