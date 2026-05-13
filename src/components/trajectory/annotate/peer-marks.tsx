'use client'

import type { PeerMark } from './types'

/**
 * Tiny strip of colored dots representing other raters' marks on the same
 * rubric. Hovering shows initials + value as a tooltip.
 *
 * Stays a flat row of <span> dots — no popovers, no portals. The point is
 * peripheral awareness; the actual numbers live in the IAA dashboard.
 *
 * Design choice: limit to first 4 peers. If more raters exist, render "+N"
 * after the dots. Beyond 4 dots the row gets noisy and the heatmap strip
 * is a better signal anyway.
 */

const MAX_VISIBLE = 4

export function PeerMarks({
  marks,
}: {
  marks: readonly PeerMark[]
}) {
  if (!marks.length) return null
  const visible = marks.slice(0, MAX_VISIBLE)
  const overflow = marks.length - visible.length

  return (
    <span
      className="inline-flex items-center gap-1"
      role="group"
      aria-label={`${marks.length} other rater${marks.length === 1 ? '' : 's'}`}
    >
      {visible.map((m) => (
        <span
          key={`${m.peerId}-${m.rubricId}`}
          title={`${m.peerInitials}: ${m.value}`}
          className="inline-flex items-center justify-center"
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: `1.5px solid ${m.color}`,
            background: `${m.color}1f`,
            fontSize: 8.5,
            lineHeight: 1,
            fontFamily: 'var(--font-mono, ui-monospace)',
            color: m.color,
            fontWeight: 600,
          }}
        >
          {m.peerInitials[0]}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="mono"
          style={{ fontSize: 10.5, color: 'var(--mute2)' }}
          title={`${overflow} more peer rating${overflow === 1 ? '' : 's'} hidden`}
        >
          +{overflow}
        </span>
      )}
    </span>
  )
}
