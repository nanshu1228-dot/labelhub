/**
 * Dawid-Skene EM algorithm — multi-rater truth inference.
 *
 * Reference: A.P. Dawid & A.M. Skene, "Maximum Likelihood Estimation of
 * Observer Error-Rates Using the EM Algorithm" (1979, Applied Statistics).
 * Also Snow et al. 2008 "Cheap and Fast — But is it Good? Evaluating
 * Non-Expert Annotations for NLP Tasks" (MTurk validation of DS on bool
 * labels) and the wikipedia "Dawid-Skene model" entry.
 *
 * Why this over majority/median voting:
 *   - If one rater systematically flips bool labels, a 2-vs-1 majority
 *     loses to the bad rater. DS down-weights them via their estimated
 *     confusion matrix.
 *   - We get a per-rater bias matrix as a free byproduct — useful for
 *     coaching ("you over-call 'true' 18% of the time").
 *
 * What this file does NOT do:
 *   - DB access (intentional — kept pure for unit testability)
 *   - server-only marker (called from server-side code, never client)
 *   - Active learning / sample selection (Phase-12)
 *
 * Pure-function contract:
 *   Input  : observations[i] = { raters: Map<raterId, observedClass> }
 *            (K = number of classes; raterIds: string set)
 *   Output : { truth[i] = posterior over K classes,
 *              confusion[r] = KxK row-stochastic matrix,
 *              classPrior = K-vector summing to 1,
 *              iterations, converged, logLikelihood }
 *
 * Numerical notes:
 *   - Class observations are 0..K-1 integers (caller maps from bool / 1-5).
 *   - We use a tiny ε=1e-9 floor inside log() to avoid log(0).
 *   - Iteration cap = 50; convergence threshold ε = 1e-4 on
 *     ‖confusion_new - confusion_old‖_∞ (max element-wise diff). The
 *     cap exists so a pathological matrix doesn't burn server CPU.
 */

export const DS_MAX_ITER = 50
export const DS_EPSILON = 1e-4
const LOG_FLOOR = 1e-9

/** A single cell with the votes raters cast on it. */
export interface DSCell {
  /** Caller-defined key — pass through unchanged in output (helpful for
   *  joining back to topic/rubric metadata). */
  key: string
  /** Map of raterId → observed class (0..K-1). Missing raters are
   *  excluded from this cell's likelihood. */
  votes: Map<string, number>
}

export interface DSInput {
  /** Number of classes the labels can take. K=2 for bool, K=5 for 1-5. */
  K: number
  /** All cells we want truth for. Even single-vote cells are OK — they
   *  just don't shift the prior much. */
  cells: DSCell[]
  /** Optional: known rater IDs to ensure they get a confusion row even
   *  if they only labeled cells outside the run. Pass an empty list to
   *  derive from cells. */
  raters?: string[]
}

export interface DSCellPosterior {
  key: string
  /** Posterior P(z=k | observations) for k = 0..K-1. Sums to 1. */
  posterior: number[]
  /** argmax k of posterior. */
  inferredClass: number
  /** posterior[inferredClass] — the "confidence" the UI shows. */
  confidence: number
  /** Number of distinct raters that voted on this cell. */
  voteCount: number
}

export interface DSRaterMatrix {
  raterId: string
  /** confusion[truth][observed] — each row sums to 1. */
  confusion: number[][]
  /** Number of vote observations this rater contributed. */
  nObservations: number
  /** Mean of the diagonal. K=2 case: (TN + TP) / 2 under uniform truth prior. */
  accuracy: number
  /**
   * Human-readable bias note. Examples:
   *   K=2: "false-pos 18%" or "false-neg 12%" (whichever is bigger and >0.10)
   *   K=5: "over-rates by 0.4" or "under-rates by 0.7" (mean shift > 0.3)
   * Null when the matrix looks balanced.
   */
  biasSummary: string | null
}

export interface DSResult {
  K: number
  iterations: number
  converged: boolean
  logLikelihood: number
  /** K-vector of marginal class prior, sums to 1. */
  classPrior: number[]
  cells: DSCellPosterior[]
  raters: DSRaterMatrix[]
}

/** Build the set of rater IDs, preserving first-seen order. */
function collectRaters(cells: DSCell[], explicit?: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  if (explicit) {
    for (const r of explicit) {
      if (!seen.has(r)) {
        seen.add(r)
        out.push(r)
      }
    }
  }
  for (const cell of cells) {
    for (const r of cell.votes.keys()) {
      if (!seen.has(r)) {
        seen.add(r)
        out.push(r)
      }
    }
  }
  return out
}

/**
 * Initialize cell posteriors from majority vote (per Dawid-Skene §3 — they
 * use "frequency of agreement", which collapses to majority when each cell
 * has integer counts). Single-vote cells start as a one-hot.
 */
function initialEstimate(input: DSInput): number[][] {
  const { K, cells } = input
  const posteriors: number[][] = []
  for (const cell of cells) {
    const counts = new Array<number>(K).fill(0)
    for (const k of cell.votes.values()) counts[k] += 1
    const total = counts.reduce((a, b) => a + b, 0)
    if (total === 0) {
      // No votes — uniform.
      posteriors.push(new Array(K).fill(1 / K))
    } else {
      posteriors.push(counts.map((c) => c / total))
    }
  }
  return posteriors
}

/** M-step: re-estimate per-rater confusion matrices + class prior from
 *  current posteriors. Uses pseudo-count Laplace smoothing (alpha=1)
 *  inside each row so a rater with no observations of class k still gets
 *  a valid probability row (uniform). */
function mStep(
  input: DSInput,
  posteriors: number[][],
  raters: string[],
): {
  confusion: number[][][]
  classPrior: number[]
} {
  const { K, cells } = input
  const R = raters.length
  const raterIdx = new Map(raters.map((r, i) => [r, i]))

  // class prior — sum of posteriors / num cells.
  const classPrior = new Array<number>(K).fill(0)
  for (const p of posteriors) {
    for (let k = 0; k < K; k++) classPrior[k] += p[k]
  }
  const totalCells = posteriors.length
  for (let k = 0; k < K; k++) {
    classPrior[k] = totalCells > 0 ? classPrior[k] / totalCells : 1 / K
  }

  // numerator[r][k][l] = Σ_i posteriors[i][k] · 1[rater r voted l on cell i]
  // denominator[r][k] = Σ_i posteriors[i][k] · 1[rater r voted on cell i]
  // (denominator depends on which cells the rater actually labeled — a
  //  rater who didn't vote on cell i contributes nothing.)
  const numerator: number[][][] = Array.from({ length: R }, () =>
    Array.from({ length: K }, () => new Array<number>(K).fill(0)),
  )
  const denominator: number[][] = Array.from({ length: R }, () =>
    new Array<number>(K).fill(0),
  )

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    const post = posteriors[i]
    for (const [raterId, observed] of cell.votes) {
      const r = raterIdx.get(raterId)
      if (r === undefined) continue
      for (let k = 0; k < K; k++) {
        numerator[r][k][observed] += post[k]
        denominator[r][k] += post[k]
      }
    }
  }

  // Laplace smoothing (alpha=1) per row so an unseen (rater, truth) pair
  // resolves to a uniform K row instead of 0/0.
  const confusion: number[][][] = numerator.map((rMat, r) =>
    rMat.map((row, k) => {
      const denom = denominator[r][k]
      if (denom <= 0) return new Array<number>(K).fill(1 / K)
      const smoothedDenom = denom + K * (1 / K) // = denom + 1
      return row.map((n) => (n + 1 / K) / smoothedDenom)
    }),
  )

  return { confusion, classPrior }
}

/** E-step: given confusion + class prior, compute posterior over latent
 *  truth for each cell. Returns also the log-likelihood sum used to
 *  monitor monotone non-decreasing increase. */
function eStep(
  input: DSInput,
  raters: string[],
  confusion: number[][][],
  classPrior: number[],
): { posteriors: number[][]; logLikelihood: number } {
  const { K, cells } = input
  const raterIdx = new Map(raters.map((r, i) => [r, i]))
  const posteriors: number[][] = []
  let logLik = 0

  for (const cell of cells) {
    // numerator_k = π_k · Π_{(r, l) in votes} confusion[r][k][l]
    const numer = new Array<number>(K).fill(0)
    for (let k = 0; k < K; k++) {
      let logTerm = Math.log(Math.max(classPrior[k], LOG_FLOOR))
      for (const [raterId, observed] of cell.votes) {
        const r = raterIdx.get(raterId)
        if (r === undefined) continue
        const p = confusion[r][k][observed]
        logTerm += Math.log(Math.max(p, LOG_FLOOR))
      }
      numer[k] = logTerm
    }
    // softmax for numerical stability.
    const maxL = Math.max(...numer)
    const exps = numer.map((l) => Math.exp(l - maxL))
    const z = exps.reduce((a, b) => a + b, 0)
    const post = exps.map((e) => (z > 0 ? e / z : 1 / K))
    posteriors.push(post)
    // log-likelihood contribution: log Σ_k exp(numer_k)
    logLik += maxL + Math.log(z)
  }
  return { posteriors, logLikelihood: logLik }
}

function matrixMaxDiff(a: number[][][], b: number[][][]): number {
  let m = 0
  for (let r = 0; r < a.length; r++) {
    for (let k = 0; k < a[r].length; k++) {
      for (let l = 0; l < a[r][k].length; l++) {
        const d = Math.abs(a[r][k][l] - b[r][k][l])
        if (d > m) m = d
      }
    }
  }
  return m
}

/**
 * Summarize a rater's bias for a human admin. We avoid over-generalizing
 * — only emit a string when the asymmetry is meaningful.
 *
 * K=2 case (boolean truth):
 *   confusion = [[TN, FP], [FN, TP]]  (rows = truth, cols = observed)
 *   - false-positive rate = FP (P(say true | truth false))
 *   - false-negative rate = FN (P(say false | truth true))
 *   Reports whichever is bigger if it exceeds 0.10.
 *
 * K>=3 case:
 *   - mean shift = Σ_k Σ_l (l-k) · P(observed=l | truth=k) / K
 *   Reports "over-rates by X" / "under-rates by X" when |shift| > 0.3.
 */
function summarizeBias(K: number, confusion: number[][]): string | null {
  if (K === 2) {
    const fp = confusion[0][1] // truth=false, observed=true
    const fn = confusion[1][0] // truth=true, observed=false
    if (fp >= fn && fp > 0.1) return `false-pos ${Math.round(fp * 100)}%`
    if (fn > fp && fn > 0.1) return `false-neg ${Math.round(fn * 100)}%`
    return null
  }
  // Ordinal/Likert summary.
  let shift = 0
  for (let k = 0; k < K; k++) {
    let rowShift = 0
    for (let l = 0; l < K; l++) {
      rowShift += (l - k) * confusion[k][l]
    }
    shift += rowShift
  }
  shift /= K
  if (Math.abs(shift) <= 0.3) return null
  const dir = shift > 0 ? 'over-rates' : 'under-rates'
  return `${dir} by ${Math.abs(shift).toFixed(1)}`
}

/**
 * Run Dawid-Skene EM. Pure function — no DB, no IO.
 *
 * Edge cases handled:
 *   - cells.length === 0 → returns empty result (no-op).
 *   - raters set empty → returns empty rater list and uniform posteriors.
 *   - K < 2 → throws (caller passed a bad config).
 *   - All raters agree on every cell → converges in 1 iter to one-hot
 *     posteriors and identity-ish confusion matrices.
 */
export function runDawidSkene(
  input: DSInput,
  options: { maxIter?: number; epsilon?: number } = {},
): DSResult {
  if (input.K < 2) throw new Error('Dawid-Skene requires K >= 2')
  const maxIter = options.maxIter ?? DS_MAX_ITER
  const epsilon = options.epsilon ?? DS_EPSILON
  const raters = collectRaters(input.cells, input.raters)

  if (input.cells.length === 0 || raters.length === 0) {
    return {
      K: input.K,
      iterations: 0,
      converged: true,
      logLikelihood: 0,
      classPrior: new Array<number>(input.K).fill(1 / input.K),
      cells: input.cells.map((cell) => ({
        key: cell.key,
        posterior: new Array<number>(input.K).fill(1 / input.K),
        inferredClass: 0,
        confidence: 1 / input.K,
        voteCount: cell.votes.size,
      })),
      raters: [],
    }
  }

  let posteriors = initialEstimate(input)
  let { confusion, classPrior } = mStep(input, posteriors, raters)
  let lastLogLik = -Infinity
  let iter = 0
  let converged = false

  for (iter = 1; iter <= maxIter; iter++) {
    const e = eStep(input, raters, confusion, classPrior)
    posteriors = e.posteriors
    const m = mStep(input, posteriors, raters)
    const diff = matrixMaxDiff(confusion, m.confusion)
    confusion = m.confusion
    classPrior = m.classPrior
    if (diff < epsilon && Math.abs(e.logLikelihood - lastLogLik) < epsilon) {
      lastLogLik = e.logLikelihood
      converged = true
      break
    }
    lastLogLik = e.logLikelihood
  }

  // Build per-rater observation counts.
  const obsCount = new Array<number>(raters.length).fill(0)
  const raterIdx = new Map(raters.map((r, i) => [r, i]))
  for (const cell of input.cells) {
    for (const r of cell.votes.keys()) {
      const idx = raterIdx.get(r)
      if (idx !== undefined) obsCount[idx] += 1
    }
  }

  const cellOut: DSCellPosterior[] = input.cells.map((cell, i) => {
    const post = posteriors[i]
    let bestK = 0
    let bestP = post[0]
    for (let k = 1; k < post.length; k++) {
      if (post[k] > bestP) {
        bestP = post[k]
        bestK = k
      }
    }
    return {
      key: cell.key,
      posterior: post,
      inferredClass: bestK,
      confidence: bestP,
      voteCount: cell.votes.size,
    }
  })

  const raterOut: DSRaterMatrix[] = raters.map((id, r) => {
    const mat = confusion[r]
    const diag = mat.reduce((s, row, k) => s + row[k], 0)
    return {
      raterId: id,
      confusion: mat,
      nObservations: obsCount[r],
      accuracy: input.K > 0 ? diag / input.K : 0,
      biasSummary: summarizeBias(input.K, mat),
    }
  })

  return {
    K: input.K,
    iterations: iter,
    converged,
    logLikelihood: lastLogLik,
    classPrior,
    cells: cellOut,
    raters: raterOut,
  }
}
