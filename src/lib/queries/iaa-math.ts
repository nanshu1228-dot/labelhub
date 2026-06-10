/**
 * IAA scoring primitives — extracted from `iaa.ts` for unit-testability.
 * No `server-only`, no DB imports — pure functions over rating arrays.
 *
 * Used by `iaa.ts` (production, scoped by workspace) AND by tests.
 */

/** Tolerance: ratings within ±this are "agreement". */
export const IAA_TOLERANCE = 1

/**
 * Spread of a set of ratings (max - min). Zero or one rating → spread 0.
 */
export function ratingSpread(ratings: number[]): number {
  if (ratings.length < 2) return 0
  return Math.max(...ratings) - Math.min(...ratings)
}

/** A "dispute" = spread strictly greater than the tolerance. */
export function isDispute(ratings: number[]): boolean {
  return ratings.length >= 2 && ratingSpread(ratings) > IAA_TOLERANCE
}

/**
 * Median of a list of numbers. Even-length lists average the two middle
 * values. Empty input → 0 (callers guard length before relying on it).
 *
 * Canonical so trust-consensus / topic-peer-consensus stop each carrying
 * their own private copy.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Pairwise agreement primitive: is `value` aligned with `reference`?
 * Aligned ⇔ they differ by at most `tolerance`. Mirrors `isDispute`'s
 * spread/tolerance rule for the two-point case (agreement = NOT dispute),
 * so peer-alignment uses the SAME definition of "agreement" as IAA.
 */
export function withinTolerance(
  value: number,
  reference: number,
  tolerance: number = IAA_TOLERANCE,
): boolean {
  return Math.abs(value - reference) <= tolerance
}

/**
 * Boolean-consensus primitive: given the count of `true` votes and `false`
 * votes among a set of raters, what's the majority?  Returns `true` /
 * `false` for a clear majority, or `null` on a tie (no clean consensus).
 *
 * One canonical definition shared by topic-peer-consensus (per-cell majority
 * display) and trust-consensus (pair-rubric alignment).
 */
export function majorityBoolean(
  trueVotes: number,
  falseVotes: number,
): boolean | null {
  if (trueVotes === falseVotes) return null
  return trueVotes > falseVotes
}

/**
 * Workspace-level agreement rate: of all steps with ≥2 raters, what
 * fraction agreed?  Returns null when no multi-rater step exists.
 */
export function agreementRate(stepsByRatings: number[][]): number | null {
  let multi = 0
  let agreed = 0
  for (const arr of stepsByRatings) {
    if (arr.length < 2) continue
    multi++
    if (!isDispute(arr)) agreed++
  }
  return multi === 0 ? null : agreed / multi
}

/**
 * Mean of a Beta posterior given `positives` / `negatives` observations and
 * a Beta(alpha, beta) prior. This is THE Bayesian-smoothing formula — both
 * the alignment-based and verdict-based trust scores route through it so the
 * smoothing lives in one place.
 */
export function betaPosteriorMean(
  positives: number,
  negatives: number,
  prior: { alpha: number; beta: number } = { alpha: 2.5, beta: 2.5 },
): number {
  return (
    (positives + prior.alpha) /
    (positives + negatives + prior.alpha + prior.beta)
  )
}

/**
 * Bayesian-smoothed consensus score for ONE rater across a set of steps.
 * Each step is represented as `{ rating: number, othersMedian: number }`
 * — the median of the OTHER raters' marks on that step. Aligned when
 * `|rating - othersMedian| ≤ tolerance`.
 */
export function trustScoreFromAlignments(
  alignments: Array<{ aligned: boolean }>,
  prior: { alpha: number; beta: number } = { alpha: 2.5, beta: 2.5 },
): number {
  let a = 0
  let d = 0
  for (const x of alignments) {
    if (x.aligned) a++
    else d++
  }
  return betaPosteriorMean(a, d, prior)
}
