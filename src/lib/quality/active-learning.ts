/**
 * Active Learning scoring — pick which topic an annotator should look
 * at next so the next label maximally reduces our uncertainty about
 * what's true.
 *
 * Phase-12. Uses the Dawid-Skene posteriors from the latest DS run
 * (Phase-11) as the uncertainty signal, with a fallback for topics DS
 * hasn't seen yet.
 *
 * Two ingredients per topic:
 *
 *  1. **Posterior entropy** — sum of Shannon entropies across all DS
 *     cells of the topic. A topic where every cell is ~50/50 (boolean)
 *     or near-uniform 1-5 carries high entropy → labeling helps a lot.
 *     A topic where DS already converged to 0.95 confidence carries
 *     low entropy → annotators' time is better spent elsewhere.
 *
 *  2. **Coverage deficit** — how many raters have submitted on this
 *     topic vs. a target (default 3). Topics with 0-1 raters score
 *     high regardless of DS (we don't yet have a posterior; DS
 *     bootstrap is just a prior). Topics with ≥3 raters score lower
 *     because the marginal information from one more is small.
 *
 * Combined: `score = α · entropy + (1 - α) · coverageGap`, normalized
 * so both terms live in [0, 1].
 *
 * Pure module — no DB, no server-only. The query layer in
 * `queries/active-learning.ts` is the IO-bound caller.
 */

/** Shannon entropy of a discrete distribution. Returns 0 for one-hot,
 *  log2(K) for uniform-K. We use log2 so the unit is "bits" — easier to
 *  reason about than nats. */
export function shannonEntropy(distribution: number[]): number {
  let h = 0
  for (const p of distribution) {
    if (p > 0) h -= p * Math.log2(p)
  }
  return h
}

/** Maximum entropy for K-class uniform = log2(K). */
export function maxEntropy(K: number): number {
  return K > 1 ? Math.log2(K) : 0
}

/**
 * Mean per-cell entropy for a topic, normalized to [0, 1] by dividing
 * by log2(K). Mean (not sum) so topics with different cell counts are
 * comparable — a 2-rubric topic shouldn't outrank a 10-rubric one
 * just by having more cells.
 */
export function topicMeanEntropy(opts: {
  cellPosteriors: number[][] // each row is a posterior over K classes
  K: number
}): number {
  if (opts.cellPosteriors.length === 0) return 0
  const cap = maxEntropy(opts.K)
  if (cap === 0) return 0
  let sum = 0
  for (const p of opts.cellPosteriors) {
    sum += shannonEntropy(p) / cap
  }
  return sum / opts.cellPosteriors.length
}

/**
 * Coverage-gap signal: linear ramp from 1.0 at 0 raters to 0.0 at the
 * target. Caps at 0 once we hit the target — extra coverage is
 * diminishing returns.
 *
 *   0 raters → 1.0
 *   1 rater  → 0.67 (target=3)
 *   2 raters → 0.33
 *   ≥3       → 0.0
 */
export function coverageGap(opts: {
  raters: number
  target?: number
}): number {
  const target = opts.target ?? 3
  if (target <= 0) return 0
  return Math.max(0, (target - opts.raters) / target)
}

/**
 * Combined IG-style score in [0, 1]. Higher = label this topic next.
 *
 *   α (default 0.6) — how much we weight DS posterior entropy vs.
 *                    coverage gap. We default >0.5 because the most
 *                    interesting case is "DS still uncertain after N
 *                    raters" — those topics genuinely need ground truth.
 *
 * Topics with NO DS posterior (never in a run) fall back to maxEntropy
 * for their entropy term — the caller passes `cellPosteriors=[]` and
 * the score collapses to coverageGap. That's intentional: a brand-new
 * topic that no one labeled should be ranked above one with low
 * coverage but mostly-aligned existing votes.
 */
export function scoreTopicIG(opts: {
  cellPosteriors: number[][]
  K: number
  raters: number
  raterTarget?: number
  alpha?: number
}): number {
  const alpha = opts.alpha ?? 0.6
  const cov = coverageGap({
    raters: opts.raters,
    target: opts.raterTarget,
  })
  // If no DS posterior is available (topic not in latest run), assume
  // maximum entropy. A new topic with no labels yet is maximally
  // uncertain by construction.
  const ent =
    opts.cellPosteriors.length === 0
      ? 1
      : topicMeanEntropy({
          cellPosteriors: opts.cellPosteriors,
          K: opts.K,
        })
  return alpha * ent + (1 - alpha) * cov
}

/** Convenience: format a score as a percentage string for UI badges. */
export function formatIgScore(score: number): string {
  return `${Math.round(score * 100)}`
}
