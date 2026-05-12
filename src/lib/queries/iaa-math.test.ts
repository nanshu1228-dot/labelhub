import { describe, expect, it } from 'vitest'
import {
  IAA_TOLERANCE,
  agreementRate,
  isDispute,
  ratingSpread,
  trustScoreFromAlignments,
} from './iaa-math'

describe('ratingSpread / isDispute', () => {
  it('returns 0 for 0 or 1 ratings', () => {
    expect(ratingSpread([])).toBe(0)
    expect(ratingSpread([5])).toBe(0)
    expect(isDispute([])).toBe(false)
    expect(isDispute([5])).toBe(false)
  })

  it('treats spread <= tolerance (1) as agreement', () => {
    expect(ratingSpread([5, 5])).toBe(0)
    expect(isDispute([5, 5])).toBe(false)
    expect(ratingSpread([5, 4])).toBe(1)
    expect(isDispute([5, 4])).toBe(false)
  })

  it('flags spread > tolerance as dispute', () => {
    expect(ratingSpread([5, 3])).toBe(2)
    expect(isDispute([5, 3])).toBe(true)
    expect(ratingSpread([5, 1])).toBe(4)
    expect(isDispute([5, 1])).toBe(true)
  })

  it('three raters: spread is max-min, not pairwise', () => {
    // 5, 5, 1 → spread 4 (extreme), even though 2/3 raters agreed.
    expect(ratingSpread([5, 5, 1])).toBe(4)
    expect(isDispute([5, 5, 1])).toBe(true)
  })

  it('tolerance constant is 1 (used by the UI)', () => {
    expect(IAA_TOLERANCE).toBe(1)
  })
})

describe('agreementRate', () => {
  it('returns null when no multi-rater step exists', () => {
    expect(agreementRate([])).toBeNull()
    expect(agreementRate([[5]])).toBeNull()
    expect(agreementRate([[5], [3], [1]])).toBeNull()
  })

  it('counts only multi-rater steps in the denominator', () => {
    // [5,5] agrees; [5,1] disputes; [5] single rater excluded
    const r = agreementRate([[5, 5], [5, 1], [5]])
    expect(r).toBeCloseTo(0.5, 6)
  })

  it('all-agree → 1.0', () => {
    expect(agreementRate([[5, 5], [3, 3], [1, 1]])).toBe(1)
  })

  it('all-dispute → 0.0', () => {
    expect(agreementRate([[5, 1], [5, 1], [5, 1]])).toBe(0)
  })
})

describe('trustScoreFromAlignments (Bayesian smoothed)', () => {
  it('zero data → prior 0.5', () => {
    expect(trustScoreFromAlignments([])).toBeCloseTo(0.5, 6)
  })

  it('all aligned → > 0.5 but never 1', () => {
    const s = trustScoreFromAlignments(
      Array.from({ length: 10 }, () => ({ aligned: true })),
    )
    expect(s).toBeGreaterThan(0.5)
    expect(s).toBeLessThan(1)
  })

  it('all diverged → < 0.5 but never 0', () => {
    const s = trustScoreFromAlignments(
      Array.from({ length: 10 }, () => ({ aligned: false })),
    )
    expect(s).toBeLessThan(0.5)
    expect(s).toBeGreaterThan(0)
  })

  it('mix is monotonic', () => {
    const eight = trustScoreFromAlignments([
      ...Array.from({ length: 8 }, () => ({ aligned: true })),
      ...Array.from({ length: 2 }, () => ({ aligned: false })),
    ])
    const six = trustScoreFromAlignments([
      ...Array.from({ length: 6 }, () => ({ aligned: true })),
      ...Array.from({ length: 4 }, () => ({ aligned: false })),
    ])
    expect(eight).toBeGreaterThan(six)
  })

  it('respects a non-default prior', () => {
    const aggressive = trustScoreFromAlignments(
      [{ aligned: true }, { aligned: true }],
      { alpha: 1, beta: 1 },
    )
    const default_ = trustScoreFromAlignments([
      { aligned: true },
      { aligned: true },
    ])
    expect(aggressive).toBeGreaterThan(default_)
  })

  it('matches the legacy projection prior on a single case', () => {
    // Same α=β=2.5, 0/0 → 0.5
    expect(trustScoreFromAlignments([])).toBeCloseTo(2.5 / 5, 6)
  })
})
