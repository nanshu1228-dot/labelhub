import type { UserTrust } from '@/lib/queries/trust-consensus'

/**
 * Compact trust-score pill — shows a rater's quality at a glance.
 *
 * IMPORTANT — VISIBILITY: trust scores are admin-only operational
 * intelligence. The badge is gated by `viewerIsAdmin`: when false, it
 * returns `null` so non-admin viewers (annotators, viewers) literally
 * cannot see anyone's score (their own or others'). Annotators see cold
 * contribution counts on /my/earnings instead — submitted/approved/rejected
 * — never a smoothed score.
 *
 * Two data sources (see `trust-consensus.ts`):
 *   - **admin**: derived from admin verdicts (`annotation.approved` /
 *     `annotation.rejected` events). Authoritative.
 *   - **peer**: derived from agreement with the median of OTHER raters.
 *     Early signal when admin hasn't reviewed yet.
 *
 * We tag the source visually with a small `A` (admin) or `P` (peer)
 * marker so admins know whether they're looking at ground truth or an
 * estimate. Tooltip shows the underlying counts.
 *
 * Color bands (Bayesian-smoothed score):
 *   ≥0.80  success green  — high alignment
 *   0.60-0.80 neutral text
 *   0.40-0.60 warn yellow — drifting; admin should review
 *   <0.40  danger red — consistent rejection / divergence
 */
export function TrustBadge({
  trust,
  viewerIsAdmin,
  size = 'md',
  showCounts = true,
}: {
  /** null when the user has no annotation activity yet. */
  trust: UserTrust | null
  /**
   * Hard visibility gate: returns null when false. Prevents annotators
   * from seeing each other's scores or their own gamified rating.
   */
  viewerIsAdmin: boolean
  size?: 'sm' | 'md'
  /** When true, append the positive/negative counts. Hidden in narrow rows. */
  showCounts?: boolean
}) {
  if (!viewerIsAdmin) return null

  // No activity at all — distinct from a 0.5 baseline.
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

  if (trust.source === 'peer') {
    return <PeerBadge trust={trust} size={size} showCounts={showCounts} />
  }
  return <AdminBadge trust={trust} size={size} showCounts={showCounts} />
}

// ─── Admin-verdict badge (authoritative) ─────────────────────────────────

function AdminBadge({
  trust,
  size,
  showCounts,
}: {
  trust: Extract<UserTrust, { source: 'admin' }>
  size: 'sm' | 'md'
  showCounts: boolean
}) {
  const total = trust.approved + trust.rejected
  if (total === 0) {
    return (
      <span
        title="No admin verdicts yet"
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
  const tier = scoreTier(trust.score)
  const pct = Math.round(trust.score * 100)
  return (
    <span
      title={`Admin verdict: ${trust.approved} approved · ${trust.rejected} rejected (Bayesian smoothed; authoritative)`}
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
      <SourceDot label="A" tier={tier} title="admin verdict" />
      <span style={{ fontWeight: 600 }}>{pct}%</span>
      {showCounts && (
        <span style={{ opacity: 0.75 }}>
          ✓{trust.approved} ✗{trust.rejected}
        </span>
      )}
    </span>
  )
}

// ─── Peer-consensus badge (early signal) ─────────────────────────────────

function PeerBadge({
  trust,
  size,
  showCounts,
}: {
  trust: Extract<UserTrust, { source: 'peer' }>
  size: 'sm' | 'md'
  showCounts: boolean
}) {
  const hasSignal = trust.aligned + trust.diverged > 0
  if (!hasSignal) {
    return (
      <span
        title={`${trust.unilateral} solo mark${trust.unilateral === 1 ? '' : 's'} — needs peer ratings or an admin review to score`}
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
      title={`Peer consensus (no admin verdicts yet): ${trust.aligned} aligned / ${trust.diverged} diverged${trust.unilateral > 0 ? ` · ${trust.unilateral} solo` : ''} (Bayesian smoothed; preliminary)`}
      className="mono shrink-0"
      style={{
        ...sizeStyle(size),
        background: tier.bg,
        color: tier.fg,
        border: `1px dashed ${tier.bord}`, // dashed = preliminary
        borderRadius: 4,
        padding: size === 'sm' ? '1px 6px' : '2px 8px',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        opacity: 0.85,
      }}
    >
      <SourceDot label="P" tier={tier} title="peer consensus" />
      <span style={{ fontWeight: 600 }}>{pct}%</span>
      {showCounts && (
        <span style={{ opacity: 0.75 }}>
          ✓{trust.aligned} ✗{trust.diverged}
        </span>
      )}
    </span>
  )
}

// ─── Visual helpers ──────────────────────────────────────────────────────

function SourceDot({
  label,
  tier,
  title,
}: {
  label: 'A' | 'P'
  tier: { bg: string; fg: string; bord: string }
  title: string
}) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 12,
        height: 12,
        borderRadius: 3,
        background: tier.fg,
        color: tier.bg,
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: 0,
      }}
    >
      {label}
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
