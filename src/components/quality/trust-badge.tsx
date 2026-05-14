import type { UserTrust } from '@/lib/queries/trust-consensus'

/**
 * Compact trust-score pill — shows a rater's quality at a glance.
 *
 * The score is Bayesian-smoothed (see `getWorkspaceTrustScores`), so a
 * rater with 0 peer-comparable steps lands at 0.5 ("uncertain") rather than
 * 100% confident. We render that case as a faded "new" pill to keep the
 * "this annotator has actual signal" pills visually distinct.
 *
 * Color bands:
 *   ≥0.80      success green  — high consensus alignment
 *   0.60-0.80  neutral text   — typical
 *   0.40-0.60  warn yellow    — drifting; admin should review
 *   <0.40      danger red     — consistent divergence; likely calibration issue
 *
 * Sizes:
 *   sm — for inline use (next to rater names in dense lists)
 *   md — for table cells / standalone badges
 */
export function TrustBadge({
  trust,
  size = 'md',
  showCounts = true,
}: {
  /** null when the user has no annotation history at all (different from 0.5 baseline). */
  trust: UserTrust | null
  size?: 'sm' | 'md'
  /** When true, append the aligned/diverged counts. Hidden in narrow contexts. */
  showCounts?: boolean
}) {
  // New rater — no signal whatsoever (not even unilateral marks).
  if (!trust) {
    return (
      <span
        title="No annotation activity yet"
        className="mono shrink-0"
        style={{
          ...sizeStyle(size),
          background: 'var(--panel2)',
          color: 'var(--mute2)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          padding: size === 'sm' ? '1px 6px' : '2px 8px',
          whiteSpace: 'nowrap',
        }}
      >
        — new
      </span>
    )
  }

  // Has activity but no peer-comparable marks → 0.5 baseline, but rendered
  // distinctly because we can't actually judge yet.
  const hasSignal = trust.aligned + trust.diverged > 0
  if (!hasSignal) {
    return (
      <span
        title={`${trust.unilateral} solo mark${trust.unilateral === 1 ? '' : 's'} — needs peer ratings to score`}
        className="mono shrink-0"
        style={{
          ...sizeStyle(size),
          background: 'var(--panel2)',
          color: 'var(--mute2)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          padding: size === 'sm' ? '1px 6px' : '2px 8px',
          whiteSpace: 'nowrap',
        }}
      >
        solo · {trust.unilateral}
      </span>
    )
  }

  const tier = scoreTier(trust.score)
  const pct = Math.round(trust.score * 100)

  return (
    <span
      title={`Trust ${pct}% · ${trust.aligned} aligned / ${trust.diverged} diverged${trust.unilateral > 0 ? ` · ${trust.unilateral} solo` : ''} (Bayesian smoothed)`}
      className="mono shrink-0"
      style={{
        ...sizeStyle(size),
        background: tier.bg,
        color: tier.fg,
        border: `1px solid ${tier.bord}`,
        borderRadius: 4,
        padding: size === 'sm' ? '1px 6px' : '2px 8px',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span style={{ fontWeight: 600 }}>{pct}%</span>
      {showCounts && (
        <span style={{ opacity: 0.75 }}>
          ✓{trust.aligned} ✗{trust.diverged}
        </span>
      )}
    </span>
  )
}

function sizeStyle(size: 'sm' | 'md') {
  return size === 'sm'
    ? { fontSize: 10, letterSpacing: '0.02em' }
    : { fontSize: 11, letterSpacing: '0.02em' }
}

function scoreTier(score: number): { bg: string; fg: string; bord: string } {
  if (score >= 0.8) {
    return {
      bg: 'var(--success-soft)',
      fg: 'var(--success)',
      bord: 'oklch(0.5 0.13 150 / 0.4)',
    }
  }
  if (score >= 0.6) {
    return {
      bg: 'oklch(0.94 0 0)',
      fg: 'var(--hi)',
      bord: 'var(--line)',
    }
  }
  if (score >= 0.4) {
    return {
      bg: 'oklch(0.7 0.14 75 / 0.08)',
      fg: 'var(--warn)',
      bord: 'oklch(0.7 0.14 75 / 0.4)',
    }
  }
  return {
    bg: 'var(--danger-soft)',
    fg: 'var(--danger)',
    bord: 'oklch(0.55 0.2 25 / 0.4)',
  }
}
