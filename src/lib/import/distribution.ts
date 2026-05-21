/**
 * Topic distribution strategies — Finals P4 D14.
 *
 * Spec 4.1: when an admin imports 1000 rows, the platform needs to
 * decide which annotator each topic lands on. Three named
 * strategies cover the realistic cases:
 *
 *   random           — uniform random shuffle, then deal out
 *   round-robin      — strict rotation through annotators
 *   quota-by-annotator — proportional split via a per-annotator
 *                        weight (capacity); leftover goes to the
 *                        most-loaded annotator
 *
 * All strategies are pure: input topics + annotator pool → array of
 * `{ topicIndex, annotatorId | null }`. `null` means "unassigned —
 * lands in the open queue". The caller writes to topics.assignedTo.
 *
 * Determinism: random takes a seed (defaults to Date.now()) so
 * tests can pin a permutation. round-robin + quota are deterministic
 * by definition.
 */

export type DistributionStrategy = 'random' | 'round-robin' | 'quota-by-annotator'

export interface DistributionInput {
  /** How many topics to distribute. */
  topicCount: number
  /**
   * Eligible annotators. For round-robin + random, only `id` is used;
   * quota mode requires a non-negative `weight` (treated as capacity).
   */
  annotators: ReadonlyArray<{ id: string; weight?: number }>
  /** Optional seed for the random strategy. */
  seed?: number
}

export interface Assignment {
  topicIndex: number
  annotatorId: string | null
}

export function distributeTopics(
  strategy: DistributionStrategy,
  input: DistributionInput,
): Assignment[] {
  switch (strategy) {
    case 'random':
      return distributeRandom(input)
    case 'round-robin':
      return distributeRoundRobin(input)
    case 'quota-by-annotator':
      return distributeQuota(input)
    default: {
      const _exhaustive: never = strategy
      return _exhaustive
    }
  }
}

function distributeRandom(input: DistributionInput): Assignment[] {
  if (input.annotators.length === 0) {
    return emptyAssignments(input.topicCount)
  }
  const rng = makeRng(input.seed ?? Date.now())
  const ids = input.annotators.map((a) => a.id)
  const out: Assignment[] = []
  for (let i = 0; i < input.topicCount; i++) {
    const idx = Math.floor(rng() * ids.length)
    out.push({ topicIndex: i, annotatorId: ids[idx] })
  }
  return out
}

function distributeRoundRobin(input: DistributionInput): Assignment[] {
  if (input.annotators.length === 0) {
    return emptyAssignments(input.topicCount)
  }
  const ids = input.annotators.map((a) => a.id)
  const out: Assignment[] = []
  for (let i = 0; i < input.topicCount; i++) {
    out.push({ topicIndex: i, annotatorId: ids[i % ids.length] })
  }
  return out
}

function distributeQuota(input: DistributionInput): Assignment[] {
  if (input.annotators.length === 0) {
    return emptyAssignments(input.topicCount)
  }
  // Sum weights; default to 1 per annotator so an unweighted
  // quota request degrades to even split.
  const weights = input.annotators.map((a) =>
    typeof a.weight === 'number' && a.weight > 0 ? a.weight : 1,
  )
  const total = weights.reduce((acc, w) => acc + w, 0)
  if (total === 0) return emptyAssignments(input.topicCount)

  // Allocate floor(weight/total * topicCount) per annotator, then
  // distribute leftovers by descending weight so the heaviest get
  // the rounding-up bonuses (matches the user mental model of
  // "Alice has 60% capacity, so she gets more").
  const targets = weights.map((w) => (w / total) * input.topicCount)
  const floors = targets.map((t) => Math.floor(t))
  let assigned = floors.reduce((acc, f) => acc + f, 0)
  let leftover = input.topicCount - assigned
  // Order by fractional remainder DESC (then weight DESC) for the
  // leftover bonuses.
  const order = targets
    .map((t, idx) => ({ idx, frac: t - Math.floor(t), w: weights[idx] }))
    .sort(
      (a, b) =>
        b.frac - a.frac ||
        b.w - a.w ||
        a.idx - b.idx,
    )
  const counts = [...floors]
  for (const { idx } of order) {
    if (leftover <= 0) break
    counts[idx]++
    leftover--
  }

  const out: Assignment[] = []
  let topicIdx = 0
  for (let a = 0; a < input.annotators.length; a++) {
    const id = input.annotators[a].id
    for (let n = 0; n < counts[a]; n++) {
      out.push({ topicIndex: topicIdx++, annotatorId: id })
    }
  }
  return out
}

function emptyAssignments(n: number): Assignment[] {
  return Array.from({ length: n }, (_, i) => ({
    topicIndex: i,
    annotatorId: null,
  }))
}

/**
 * Deterministic LCG PRNG. Good enough for distribute-evenly; not for
 * crypto. Same seed → same sequence so tests can assert.
 */
function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}
