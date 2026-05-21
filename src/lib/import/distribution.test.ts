import { describe, it, expect } from 'vitest'
import { distributeTopics } from './distribution'

/**
 * Distribution-strategy tests — Finals P4 D14.
 *
 * Spec 4.1 demands 3 named strategies. These tests cover each
 * matrix dimension: empty annotator pool (degrades to unassigned),
 * uneven topic-to-annotator ratios (no off-by-one losses), and
 * deterministic-vs-random seeding.
 */

const ANNOTATORS = [
  { id: 'alice' },
  { id: 'bob' },
  { id: 'carol' },
]

describe('distributeTopics — round-robin', () => {
  it('rotates through annotators in order', () => {
    const a = distributeTopics('round-robin', {
      topicCount: 6,
      annotators: ANNOTATORS,
    })
    expect(a.map((x) => x.annotatorId)).toEqual([
      'alice',
      'bob',
      'carol',
      'alice',
      'bob',
      'carol',
    ])
  })

  it('handles topic count < annotator count', () => {
    const a = distributeTopics('round-robin', {
      topicCount: 2,
      annotators: ANNOTATORS,
    })
    expect(a.map((x) => x.annotatorId)).toEqual(['alice', 'bob'])
  })

  it('preserves topicIndex 0..N-1', () => {
    const a = distributeTopics('round-robin', {
      topicCount: 5,
      annotators: ANNOTATORS,
    })
    expect(a.map((x) => x.topicIndex)).toEqual([0, 1, 2, 3, 4])
  })

  it('empty annotator pool → all unassigned', () => {
    const a = distributeTopics('round-robin', {
      topicCount: 3,
      annotators: [],
    })
    expect(a.every((x) => x.annotatorId === null)).toBe(true)
  })
})

describe('distributeTopics — random', () => {
  it('uses the seed deterministically', () => {
    const a = distributeTopics('random', {
      topicCount: 10,
      annotators: ANNOTATORS,
      seed: 42,
    })
    const b = distributeTopics('random', {
      topicCount: 10,
      annotators: ANNOTATORS,
      seed: 42,
    })
    expect(a).toEqual(b)
  })

  it('different seeds produce different permutations (usually)', () => {
    const a = distributeTopics('random', {
      topicCount: 30,
      annotators: ANNOTATORS,
      seed: 1,
    })
    const b = distributeTopics('random', {
      topicCount: 30,
      annotators: ANNOTATORS,
      seed: 2,
    })
    expect(a).not.toEqual(b)
  })

  it('only picks from the annotator pool', () => {
    const ids = new Set(ANNOTATORS.map((a) => a.id))
    const out = distributeTopics('random', {
      topicCount: 50,
      annotators: ANNOTATORS,
      seed: 7,
    })
    for (const o of out) {
      expect(ids.has(o.annotatorId ?? '')).toBe(true)
    }
  })

  it('empty pool → all unassigned', () => {
    const a = distributeTopics('random', {
      topicCount: 4,
      annotators: [],
      seed: 9,
    })
    expect(a.every((x) => x.annotatorId === null)).toBe(true)
  })
})

describe('distributeTopics — quota-by-annotator', () => {
  it('splits by weight proportionally', () => {
    const a = distributeTopics('quota-by-annotator', {
      topicCount: 10,
      annotators: [
        { id: 'alice', weight: 6 },
        { id: 'bob', weight: 4 },
      ],
    })
    const counts = a.reduce<Record<string, number>>((acc, x) => {
      const k = x.annotatorId ?? '__null'
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    expect(counts.alice).toBe(6)
    expect(counts.bob).toBe(4)
  })

  it('handles fractional splits via leftover bonus', () => {
    const a = distributeTopics('quota-by-annotator', {
      topicCount: 10,
      annotators: [
        { id: 'alice', weight: 1 },
        { id: 'bob', weight: 1 },
        { id: 'carol', weight: 1 },
      ],
    })
    const counts = a.reduce<Record<string, number>>((acc, x) => {
      const k = x.annotatorId ?? '__null'
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    // 10 / 3 = 3 + 1 leftover; one annotator gets 4, others 3.
    const sorted = Object.values(counts).sort()
    expect(sorted).toEqual([3, 3, 4])
  })

  it('falls back to unweighted (1 each) when weights are absent', () => {
    const a = distributeTopics('quota-by-annotator', {
      topicCount: 6,
      annotators: ANNOTATORS,
    })
    const counts = a.reduce<Record<string, number>>((acc, x) => {
      const k = x.annotatorId ?? '__null'
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    expect(counts.alice).toBe(2)
    expect(counts.bob).toBe(2)
    expect(counts.carol).toBe(2)
  })

  it('total assignments equals topicCount', () => {
    const a = distributeTopics('quota-by-annotator', {
      topicCount: 17,
      annotators: [
        { id: 'a', weight: 5 },
        { id: 'b', weight: 3 },
        { id: 'c', weight: 7 },
      ],
    })
    expect(a.length).toBe(17)
  })

  it('empty pool → all unassigned', () => {
    const a = distributeTopics('quota-by-annotator', {
      topicCount: 5,
      annotators: [],
    })
    expect(a.every((x) => x.annotatorId === null)).toBe(true)
  })

  it('zero/negative weights treated as 1 (no division-by-zero)', () => {
    const a = distributeTopics('quota-by-annotator', {
      topicCount: 4,
      annotators: [
        { id: 'a', weight: 0 },
        { id: 'b', weight: -5 },
      ],
    })
    // Both treated as weight=1 → split 50/50.
    const counts = a.reduce<Record<string, number>>((acc, x) => {
      const k = x.annotatorId ?? '__null'
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    expect(counts.a).toBe(2)
    expect(counts.b).toBe(2)
  })
})

describe('distributeTopics — common', () => {
  it('topicCount 0 returns empty array', () => {
    expect(
      distributeTopics('round-robin', {
        topicCount: 0,
        annotators: ANNOTATORS,
      }),
    ).toEqual([])
  })

  it('all topicIndex values are unique', () => {
    const out = distributeTopics('random', {
      topicCount: 20,
      annotators: ANNOTATORS,
      seed: 1,
    })
    const set = new Set(out.map((x) => x.topicIndex))
    expect(set.size).toBe(20)
  })
})
