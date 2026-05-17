import { describe, it, expect } from 'vitest'
import {
  shannonEntropy,
  maxEntropy,
  topicMeanEntropy,
  coverageGap,
  scoreTopicIG,
} from './active-learning'

describe('shannonEntropy', () => {
  it('is 0 for one-hot distributions', () => {
    expect(shannonEntropy([1, 0])).toBe(0)
    expect(shannonEntropy([0, 0, 1, 0, 0])).toBe(0)
  })

  it('is log2(K) for uniform-K distributions', () => {
    expect(shannonEntropy([0.5, 0.5])).toBeCloseTo(1, 6) // log2(2)
    expect(shannonEntropy([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(2, 6)
    expect(
      shannonEntropy([0.2, 0.2, 0.2, 0.2, 0.2]),
    ).toBeCloseTo(Math.log2(5), 6)
  })

  it('treats 0-probability bins gracefully (no -∞)', () => {
    const h = shannonEntropy([0.9, 0.1, 0, 0, 0])
    expect(Number.isFinite(h)).toBe(true)
    expect(h).toBeGreaterThan(0)
  })
})

describe('maxEntropy', () => {
  it('returns log2(K)', () => {
    expect(maxEntropy(2)).toBe(1)
    expect(maxEntropy(5)).toBeCloseTo(Math.log2(5), 6)
  })
  it('returns 0 for degenerate K', () => {
    expect(maxEntropy(1)).toBe(0)
    expect(maxEntropy(0)).toBe(0)
  })
})

describe('topicMeanEntropy', () => {
  it('normalizes to [0, 1] per K', () => {
    // 2 cells, both 50/50 → max entropy → normalized 1.0
    expect(
      topicMeanEntropy({
        cellPosteriors: [
          [0.5, 0.5],
          [0.5, 0.5],
        ],
        K: 2,
      }),
    ).toBeCloseTo(1, 6)
  })

  it('is 0 when every cell is one-hot', () => {
    expect(
      topicMeanEntropy({
        cellPosteriors: [
          [1, 0],
          [0, 1],
        ],
        K: 2,
      }),
    ).toBe(0)
  })

  it('averages across cells (a mix of confident + uncertain)', () => {
    // one one-hot (0), one uniform (1) → mean 0.5
    expect(
      topicMeanEntropy({
        cellPosteriors: [
          [1, 0],
          [0.5, 0.5],
        ],
        K: 2,
      }),
    ).toBeCloseTo(0.5, 6)
  })

  it('returns 0 for empty input', () => {
    expect(
      topicMeanEntropy({ cellPosteriors: [], K: 2 }),
    ).toBe(0)
  })
})

describe('coverageGap', () => {
  it('is 1.0 for 0 raters (need first label)', () => {
    expect(coverageGap({ raters: 0 })).toBe(1)
  })

  it('linearly decreases toward target', () => {
    expect(coverageGap({ raters: 1, target: 3 })).toBeCloseTo(2 / 3, 6)
    expect(coverageGap({ raters: 2, target: 3 })).toBeCloseTo(1 / 3, 6)
  })

  it('caps at 0 once target reached', () => {
    expect(coverageGap({ raters: 3, target: 3 })).toBe(0)
    expect(coverageGap({ raters: 10, target: 3 })).toBe(0)
  })
})

describe('scoreTopicIG', () => {
  it('zero-coverage zero-DS topic scores HIGH (need first label)', () => {
    const s = scoreTopicIG({
      cellPosteriors: [], // not in DS run yet
      K: 2,
      raters: 0,
    })
    // alpha=0.6 → 0.6 * 1 (max entropy fallback) + 0.4 * 1 (full gap) = 1
    expect(s).toBeCloseTo(1, 6)
  })

  it('fully-covered all-confident topic scores ~0', () => {
    const s = scoreTopicIG({
      cellPosteriors: [
        [1, 0],
        [0, 1],
        [1, 0],
      ],
      K: 2,
      raters: 3,
    })
    expect(s).toBeCloseTo(0, 6)
  })

  it('high-disagreement well-covered topic still scores HIGH', () => {
    // 3 raters in, but DS posterior is still 50/50 → labeling helps.
    const s = scoreTopicIG({
      cellPosteriors: [
        [0.5, 0.5],
        [0.5, 0.5],
      ],
      K: 2,
      raters: 3,
    })
    // 0.6 * 1 + 0.4 * 0 = 0.6
    expect(s).toBeCloseTo(0.6, 6)
  })

  it('orders new (uncovered) over old (covered confident)', () => {
    const newTopic = scoreTopicIG({
      cellPosteriors: [],
      K: 2,
      raters: 0,
    })
    const oldTopic = scoreTopicIG({
      cellPosteriors: [
        [0.95, 0.05],
        [0.05, 0.95],
      ],
      K: 2,
      raters: 5,
    })
    expect(newTopic).toBeGreaterThan(oldTopic)
  })

  it('respects custom alpha (pure-entropy weighting)', () => {
    const sZeroAlpha = scoreTopicIG({
      cellPosteriors: [
        [0.5, 0.5],
        [0.5, 0.5],
      ],
      K: 2,
      raters: 3,
      alpha: 0, // ignore entropy, only coverage
    })
    expect(sZeroAlpha).toBe(0) // coverage gap = 0 at target
    const sFullAlpha = scoreTopicIG({
      cellPosteriors: [
        [0.5, 0.5],
        [0.5, 0.5],
      ],
      K: 2,
      raters: 3,
      alpha: 1, // ignore coverage, only entropy
    })
    expect(sFullAlpha).toBeCloseTo(1, 6) // max entropy
  })
})
