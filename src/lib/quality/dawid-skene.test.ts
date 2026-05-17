import { describe, it, expect } from 'vitest'
import { runDawidSkene, type DSCell, DS_MAX_ITER } from './dawid-skene'

// ───────────────────────────────────────────────────────────────────────
// Helpers — toy data generators.
//
// `makeBinaryCells` fabricates K=2 votes where each rater has a known
// confusion matrix vs. a known ground truth. Useful for asserting EM
// recovers the truth direction with high probability.
// ───────────────────────────────────────────────────────────────────────

interface RaterSpec {
  id: string
  /** P(say 'true' | truth 'true') — sensitivity. */
  tpr: number
  /** P(say 'true' | truth 'false') — false-positive rate. */
  fpr: number
}

/**
 * Deterministic PRNG (mulberry32) so the test is reproducible — we hate
 * flaky tests that pass on the contributor's machine and fail in CI.
 */
function rng(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function makeBinaryCells({
  groundTruth,
  raters,
  seed = 1,
}: {
  groundTruth: number[]
  raters: RaterSpec[]
  seed?: number
}): DSCell[] {
  const rand = rng(seed)
  return groundTruth.map((truth, i) => {
    const votes = new Map<string, number>()
    for (const rater of raters) {
      const sayTrueProb = truth === 1 ? rater.tpr : rater.fpr
      votes.set(rater.id, rand() < sayTrueProb ? 1 : 0)
    }
    return { key: `cell-${i}`, votes }
  })
}

// ───────────────────────────────────────────────────────────────────────
// Spec
// ───────────────────────────────────────────────────────────────────────

describe('runDawidSkene — degenerate inputs', () => {
  it('returns empty result when there are no cells', () => {
    const r = runDawidSkene({ K: 2, cells: [] })
    expect(r.cells).toEqual([])
    expect(r.raters).toEqual([])
    expect(r.converged).toBe(true)
    expect(r.iterations).toBe(0)
  })

  it('returns high-confidence inferred class when all raters agree', () => {
    // Use enough cells so Laplace smoothing doesn't drag posteriors —
    // with only 2 cells the alpha=1/K pseudo-count is significant
    // relative to the evidence.
    const cells: DSCell[] = []
    for (let i = 0; i < 20; i++) {
      const k = i % 2
      cells.push({
        key: `c${i}`,
        votes: new Map([
          ['a', k],
          ['b', k],
          ['c', k],
        ]),
      })
    }
    const r = runDawidSkene({ K: 2, cells })
    // Every cell should be classified correctly with > 0.9 confidence
    // — unanimous votes over 20+ cells are unambiguous.
    for (let i = 0; i < cells.length; i++) {
      expect(r.cells[i].inferredClass).toBe(i % 2)
      expect(r.cells[i].confidence).toBeGreaterThan(0.9)
    }
  })

  it('throws when K < 2', () => {
    expect(() => runDawidSkene({ K: 1, cells: [] })).toThrow(/K >= 2/)
  })
})

describe('runDawidSkene — recovers ground truth on noisy binary data', () => {
  it('majority of good raters + 1 noisy rater → DS recovers truth', () => {
    // 100 cells, 50/50 truth split. Two good raters (90% accurate) plus
    // one near-coinflip rater. DS should give near-perfect recall.
    const groundTruth = Array.from({ length: 100 }, (_, i) => i % 2)
    const cells = makeBinaryCells({
      groundTruth,
      raters: [
        { id: 'good1', tpr: 0.9, fpr: 0.1 },
        { id: 'good2', tpr: 0.9, fpr: 0.1 },
        { id: 'noisy', tpr: 0.55, fpr: 0.45 },
      ],
      seed: 42,
    })

    const r = runDawidSkene({ K: 2, cells })
    expect(r.converged).toBe(true)

    let correct = 0
    for (let i = 0; i < groundTruth.length; i++) {
      if (r.cells[i].inferredClass === groundTruth[i]) correct++
    }
    // At least 90% of inferred labels match ground truth — much
    // better than the noisy rater's 55%.
    expect(correct / groundTruth.length).toBeGreaterThanOrEqual(0.9)
  })

  it('down-weights a systematically-biased rater', () => {
    // One adversarial rater inverts everything (tpr=0.05, fpr=0.95) — the
    // M-step should learn their confusion matrix is anti-aligned and
    // discount them. Two honest raters should still drive truth.
    const groundTruth = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 1 : 0))
    const cells = makeBinaryCells({
      groundTruth,
      raters: [
        { id: 'honest1', tpr: 0.88, fpr: 0.12 },
        { id: 'honest2', tpr: 0.88, fpr: 0.12 },
        { id: 'adversarial', tpr: 0.05, fpr: 0.95 },
      ],
      seed: 7,
    })

    const r = runDawidSkene({ K: 2, cells })
    const adversarial = r.raters.find((x) => x.raterId === 'adversarial')!
    // adversarial confusion[0][1] = P(observed=1 | truth=0) should be HIGH
    // (≈0.95). adversarial confusion[1][0] = P(observed=0 | truth=1)
    // should also be HIGH (≈0.95). I.e. low accuracy.
    expect(adversarial.accuracy).toBeLessThan(0.2)
    expect(adversarial.biasSummary).not.toBeNull()

    const honest = r.raters.find((x) => x.raterId === 'honest1')!
    expect(honest.accuracy).toBeGreaterThan(0.8)

    // Inference still ≥85% correct on this small set.
    let correct = 0
    for (let i = 0; i < groundTruth.length; i++) {
      if (r.cells[i].inferredClass === groundTruth[i]) correct++
    }
    expect(correct / groundTruth.length).toBeGreaterThanOrEqual(0.85)
  })

  it('handles missing votes — a rater that skipped some cells contributes only where present', () => {
    const groundTruth = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]
    const goodVotes = (truth: number) => (Math.random() < 0.9 ? truth : 1 - truth)
    void goodVotes
    // Set up by hand to be deterministic.
    const cells: DSCell[] = groundTruth.map((truth, i) => {
      const votes = new Map<string, number>()
      votes.set('alice', truth) // always correct
      votes.set('bob', truth) // always correct
      if (i % 2 === 0) votes.set('charlie', 1 - truth) // only on evens, wrong
      return { key: `c${i}`, votes }
    })

    const r = runDawidSkene({ K: 2, cells })
    for (let i = 0; i < cells.length; i++) {
      expect(r.cells[i].inferredClass).toBe(groundTruth[i])
    }
    // Charlie only voted on 5 cells, all wrong on truth=0. Accuracy
    // averages the diagonal across truth=0 (≈0.08 — heavily smoothed
    // toward observed=1) and truth=1 (uniform 0.5 fallback since he
    // never saw a truth=1 cell), so ≈ 0.29. Still well below the 0.5
    // uniform baseline.
    const charlie = r.raters.find((x) => x.raterId === 'charlie')!
    expect(charlie.nObservations).toBe(5)
    expect(charlie.accuracy).toBeLessThan(0.4)
    // Bias signal should fire — charlie says 1 on truth=0 → false-pos.
    expect(charlie.biasSummary).toMatch(/false-pos/)
  })
})

describe('runDawidSkene — likert (K=5) ordinal labels', () => {
  it('recovers latent score from noisy 1-5 ratings', () => {
    // Truth = repeating 0..4 (i.e. classes 0,1,2,3,4). Three raters,
    // each adds ±1 jitter with 30% probability.
    const groundTruth = Array.from({ length: 50 }, (_, i) => i % 5)
    const rand = rng(99)
    const jitter = (truth: number) => {
      if (rand() < 0.7) return truth
      const delta = rand() < 0.5 ? -1 : 1
      return Math.max(0, Math.min(4, truth + delta))
    }
    const cells: DSCell[] = groundTruth.map((truth, i) => {
      const votes = new Map<string, number>()
      votes.set('r1', jitter(truth))
      votes.set('r2', jitter(truth))
      votes.set('r3', jitter(truth))
      return { key: `c${i}`, votes }
    })

    const r = runDawidSkene({ K: 5, cells })
    // K=5 with ordinal noise can hit the iter cap on small samples,
    // but the inferred class is still meaningful — don't assert
    // convergence here.

    let correct = 0
    let within1 = 0
    for (let i = 0; i < groundTruth.length; i++) {
      const inf = r.cells[i].inferredClass
      if (inf === groundTruth[i]) correct++
      if (Math.abs(inf - groundTruth[i]) <= 1) within1++
    }
    expect(within1 / groundTruth.length).toBeGreaterThanOrEqual(0.9)
    expect(correct / groundTruth.length).toBeGreaterThanOrEqual(0.5)
  })
})

describe('runDawidSkene — output shape invariants', () => {
  it('every posterior sums to ~1 and confidence ∈ [1/K, 1]', () => {
    const cells: DSCell[] = [
      { key: 'a', votes: new Map([['x', 1], ['y', 0]]) },
      { key: 'b', votes: new Map([['x', 1], ['y', 1]]) },
    ]
    const r = runDawidSkene({ K: 2, cells })
    for (const c of r.cells) {
      const sum = c.posterior.reduce((a, b) => a + b, 0)
      expect(Math.abs(sum - 1)).toBeLessThan(1e-6)
      expect(c.confidence).toBeGreaterThanOrEqual(0.5)
      expect(c.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('every confusion row sums to ~1', () => {
    const cells: DSCell[] = Array.from({ length: 5 }, (_, i) => ({
      key: `c${i}`,
      votes: new Map<string, number>([
        ['a', i % 2],
        ['b', i % 2],
      ]),
    }))
    const r = runDawidSkene({ K: 2, cells })
    for (const rater of r.raters) {
      for (const row of rater.confusion) {
        const sum = row.reduce((a, b) => a + b, 0)
        expect(Math.abs(sum - 1)).toBeLessThan(1e-6)
      }
    }
  })

  it('log-likelihood is finite and iterations ≤ cap', () => {
    const groundTruth = Array.from({ length: 30 }, (_, i) => i % 2)
    const cells = makeBinaryCells({
      groundTruth,
      raters: [
        { id: 'a', tpr: 0.8, fpr: 0.2 },
        { id: 'b', tpr: 0.8, fpr: 0.2 },
      ],
      seed: 12,
    })
    const r = runDawidSkene({ K: 2, cells })
    expect(Number.isFinite(r.logLikelihood)).toBe(true)
    expect(r.iterations).toBeLessThanOrEqual(DS_MAX_ITER)
  })
})

describe('runDawidSkene — bias summary', () => {
  it('flags false-positive bias for a permissive rater', () => {
    // truth: half 0s half 1s. "Permissive" rater always says 1.
    const groundTruth = [0, 0, 0, 0, 1, 1, 1, 1]
    const cells: DSCell[] = groundTruth.map((truth, i) => {
      const votes = new Map<string, number>()
      votes.set('honest', truth)
      votes.set('honest2', truth)
      votes.set('permissive', 1)
      return { key: `c${i}`, votes }
    })

    const r = runDawidSkene({ K: 2, cells })
    const perm = r.raters.find((x) => x.raterId === 'permissive')!
    expect(perm.biasSummary).toMatch(/false-pos/)
  })

  it('returns null bias for a near-balanced rater with enough data', () => {
    // Need enough cells so smoothing doesn't manufacture a 0.10 false-pos
    // signal — at N=40 the Laplace pseudo-count is < 0.025 per row.
    const groundTruth = Array.from({ length: 40 }, (_, i) => i % 2)
    const cells: DSCell[] = groundTruth.map((truth, i) => {
      const votes = new Map<string, number>([
        ['careful', truth],
        ['careful2', truth],
      ])
      return { key: `c${i}`, votes }
    })
    const r = runDawidSkene({ K: 2, cells })
    expect(r.raters[0].biasSummary).toBeNull()
  })
})
