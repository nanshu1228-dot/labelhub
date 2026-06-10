import { describe, it, expect } from 'vitest'
import { navigationIntentForKey, neighborIds } from './use-prev-next-nav'

/**
 * Keyboard nav helper — pure neighborIds() tests (Finals P5 D16).
 *
 * The hook's listener is window-bound and exercised by hand /
 * Playwright; the pure helper that decides prev/next ids gets the
 * unit-test coverage.
 */

describe('neighborIds', () => {
  it('returns prev=null, next=second when at the start', () => {
    expect(neighborIds(['a', 'b', 'c'], 'a')).toEqual({
      prev: null,
      next: 'b',
    })
  })

  it('returns prev=second-to-last, next=null when at the end', () => {
    expect(neighborIds(['a', 'b', 'c'], 'c')).toEqual({
      prev: 'b',
      next: null,
    })
  })

  it('returns the surrounding pair when in the middle', () => {
    expect(neighborIds(['a', 'b', 'c'], 'b')).toEqual({
      prev: 'a',
      next: 'c',
    })
  })

  it('returns null/null when the id is missing', () => {
    expect(neighborIds(['a', 'b'], 'absent')).toEqual({
      prev: null,
      next: null,
    })
  })

  it('handles a single-item list', () => {
    expect(neighborIds(['only'], 'only')).toEqual({
      prev: null,
      next: null,
    })
  })

  it('handles an empty list', () => {
    expect(neighborIds([], 'any')).toEqual({ prev: null, next: null })
  })
})

describe('navigationIntentForKey', () => {
  it('maps queue navigation shortcuts', () => {
    expect(navigationIntentForKey('j')).toBe('next')
    expect(navigationIntentForKey('ArrowDown')).toBe('next')
    expect(navigationIntentForKey('N')).toBe('next')
    expect(navigationIntentForKey('k')).toBe('prev')
    expect(navigationIntentForKey('ArrowUp')).toBe('prev')
    expect(navigationIntentForKey('P')).toBe('prev')
    expect(navigationIntentForKey('s')).toBe('skip')
    expect(navigationIntentForKey('S')).toBe('skip')
  })

  it('ignores unrelated keys', () => {
    expect(navigationIntentForKey('Enter')).toBeNull()
    expect(navigationIntentForKey('x')).toBeNull()
  })
})
