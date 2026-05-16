import { describe, it, expect } from 'vitest'
import { lineDiff } from '@/lib/queries/guideline-history'

/**
 * Pure-function tests of the LCS line-diff. Pins the unified-diff
 * contract so a future "smart diff" rewrite has a target.
 */
describe('lineDiff', () => {
  it('returns all equal when texts match', () => {
    const out = lineDiff('a\nb\nc', 'a\nb\nc')
    expect(out.map((d) => d.kind)).toEqual(['equal', 'equal', 'equal'])
  })

  it('adds new lines at end', () => {
    const out = lineDiff('a\nb', 'a\nb\nc')
    expect(out[0]).toEqual({ kind: 'equal', line: 'a' })
    expect(out[1]).toEqual({ kind: 'equal', line: 'b' })
    expect(out[2]).toEqual({ kind: 'add', line: 'c' })
  })

  it('deletes removed lines from middle', () => {
    const out = lineDiff('a\nb\nc', 'a\nc')
    const kinds = out.map((d) => d.kind)
    expect(kinds).toEqual(['equal', 'del', 'equal'])
    expect(out[1].line).toBe('b')
  })

  it('marks a replaced line as del + add', () => {
    const out = lineDiff('a\nold\nc', 'a\nnew\nc')
    const kinds = out.map((d) => d.kind)
    // LCS keeps `a` and `c` and emits del(old) + add(new) for the middle.
    expect(kinds).toContain('del')
    expect(kinds).toContain('add')
    expect(out.find((d) => d.kind === 'del')?.line).toBe('old')
    expect(out.find((d) => d.kind === 'add')?.line).toBe('new')
  })

  it('handles total rewrite (no overlap)', () => {
    const out = lineDiff('x\ny\nz', 'a\nb\nc')
    const dels = out.filter((d) => d.kind === 'del')
    const adds = out.filter((d) => d.kind === 'add')
    expect(dels.length).toBe(3)
    expect(adds.length).toBe(3)
    expect(out.filter((d) => d.kind === 'equal').length).toBe(0)
  })

  it('preserves order when interleaving keeps + changes', () => {
    const oldT = 'one\ntwo\nthree\nfour'
    const newT = 'one\ntwo-new\nthree\nfive'
    const out = lineDiff(oldT, newT)
    // First line equal, second line replaced, third equal, fourth replaced.
    expect(out[0]).toEqual({ kind: 'equal', line: 'one' })
    // del(two) + add(two-new) in some order — only require both present.
    const middle = out.slice(1, 3)
    expect(middle.some((d) => d.kind === 'del' && d.line === 'two')).toBe(true)
    expect(
      middle.some((d) => d.kind === 'add' && d.line === 'two-new'),
    ).toBe(true)
    expect(out.find((d) => d.kind === 'equal' && d.line === 'three')).toBeTruthy()
    expect(out.find((d) => d.kind === 'del' && d.line === 'four')).toBeTruthy()
    expect(out.find((d) => d.kind === 'add' && d.line === 'five')).toBeTruthy()
  })

  it('treats empty strings as one empty line each', () => {
    const out = lineDiff('', '')
    expect(out).toEqual([{ kind: 'equal', line: '' }])
  })
})
