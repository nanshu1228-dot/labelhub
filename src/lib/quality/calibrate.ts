import type { Mark } from '@/lib/templates/rubric'

/**
 * Compare a user's marks against gold-standard marks → calibration tally.
 *
 * **Match rules** (per scale):
 *   - likert: within ±1 (matches IAA dispute-detection tolerance)
 *   - bool:   exact match
 *   - enum:   exact match
 *   - text:   SKIPPED — text answers aren't auto-comparable. Counted in
 *             `skipped` so the UI can be honest about coverage.
 *
 * Marks present in user but NOT in gold are SKIPPED (gold defines the
 * answer surface; the user can answer extra rubrics without penalty).
 * Marks present in gold but missing from the user count as `missed` —
 * not "diverged" — so we don't conflate omission with disagreement.
 *
 * **Returns** raw counts so callers can aggregate across many golds before
 * applying Bayesian smoothing. The per-rubric breakdown helps the UI show
 * "you got tool_choice right but missed goal_achieved on this gold".
 */

export interface MarkMatch {
  rubricId: string
  /** Bucket: 'matched' | 'diverged' | 'missed' | 'skipped' */
  kind: 'matched' | 'diverged' | 'missed' | 'skipped'
  /** Gold's answer for context (omitted when scale=text). */
  gold?: Mark
  /** User's answer (omitted when missed). */
  user?: Mark
}

export interface CalibrationResult {
  matched: number
  diverged: number
  missed: number
  skipped: number
  /** Per-rubric matches for UI breakdown. */
  detail: MarkMatch[]
}

/**
 * Compare one rubric slot. Returns the bucket label.
 *
 * Caller is responsible for knowing whether to call this — we don't enforce
 * gold-defined-the-surface here, so passing user-only or gold-only marks is
 * valid: just check which arg is undefined.
 */
export function compareMark(
  rubricId: string,
  gold: Mark | undefined,
  user: Mark | undefined,
): MarkMatch {
  if (!gold) {
    // Gold doesn't constrain this rubric → not a comparison.
    return { rubricId, kind: 'skipped', user }
  }
  if (gold.scale === 'text') {
    // Text isn't auto-comparable.
    return { rubricId, kind: 'skipped', gold }
  }
  if (!user) {
    return { rubricId, kind: 'missed', gold }
  }
  // Scale-aligned compare. If user's scale doesn't match gold's, that's
  // structurally divergent (someone changed the rubric mid-stream).
  if (user.scale !== gold.scale) {
    return { rubricId, kind: 'diverged', gold, user }
  }

  switch (gold.scale) {
    case 'likert': {
      const u = (user as Extract<Mark, { scale: 'likert' }>).value
      const g = gold.value
      const matched = Math.abs(u - g) <= 1
      return { rubricId, kind: matched ? 'matched' : 'diverged', gold, user }
    }
    case 'bool': {
      const u = (user as Extract<Mark, { scale: 'bool' }>).value
      const matched = u === gold.value
      return { rubricId, kind: matched ? 'matched' : 'diverged', gold, user }
    }
    case 'enum': {
      const u = (user as Extract<Mark, { scale: 'enum' }>).value
      const matched = u === gold.value
      return { rubricId, kind: matched ? 'matched' : 'diverged', gold, user }
    }
    default:
      // exhaustive — text handled above
      return { rubricId, kind: 'skipped', gold }
  }
}

/**
 * Bulk-compare user vs. gold over a flat rubric → Mark map.
 *
 * Used twice per trajectory: once for trajectory-level marks, once per step.
 * Caller sums the resulting `CalibrationResult`s for a per-user total.
 */
export function calibrateMarkSet(opts: {
  goldMarks: Record<string, Mark>
  userMarks: Record<string, Mark>
}): CalibrationResult {
  const out: CalibrationResult = {
    matched: 0,
    diverged: 0,
    missed: 0,
    skipped: 0,
    detail: [],
  }
  for (const [rubricId, gold] of Object.entries(opts.goldMarks)) {
    const user = opts.userMarks[rubricId]
    const m = compareMark(rubricId, gold, user)
    out.detail.push(m)
    out[m.kind]++
  }
  return out
}

// ─── Bayesian smoothing — same prior as trust scores ──────────────────────

const PRIOR_ALPHA = 2.5
const PRIOR_BETA = 2.5

/**
 * Smooth a matched/diverged tally into a score in [0, 1]. New raters with
 * no calibration data land at 0.5. Same α=β=2.5 as the trust scorers so
 * the numbers are commensurable.
 */
export function smoothCalibration(matched: number, diverged: number): number {
  return (
    (matched + PRIOR_ALPHA) /
    (matched + diverged + PRIOR_ALPHA + PRIOR_BETA)
  )
}
