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
  return (a + prior.alpha) / (a + d + prior.alpha + prior.beta)
}
