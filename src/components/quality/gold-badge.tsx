/**
 * Compact "GOLD" badge for trajectories that have been promoted to gold-standard.
 *
 * Visible to everyone (not admin-gated) — the EXISTENCE of a gold marker
 * isn't sensitive, it's a quality indicator. Only the calibration scores
 * derived from it are admin-only.
 *
 * Two sizes:
 *   sm — for inline use (trajectory list rows)
 *   md — for standalone headers
 */
export function GoldBadge({
  size = 'md',
  title,
}: {
  size?: 'sm' | 'md'
  title?: string
}) {
  return (
    <span
      title={title ?? 'Reference answer frozen by a workspace admin'}
      className="mono shrink-0"
      style={{
        background:
          'linear-gradient(135deg, oklch(0.92 0.13 90 / 0.18), oklch(0.88 0.16 70 / 0.18))',
        color: 'oklch(0.5 0.16 70)',
        border: '1px solid oklch(0.7 0.16 75 / 0.5)',
        borderRadius: 4,
        padding: size === 'sm' ? '1px 6px' : '2px 8px',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: size === 'sm' ? 10 : 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
      }}
    >
      <span style={{ fontSize: size === 'sm' ? 9 : 10 }}>★</span>
      GOLD
    </span>
  )
}
