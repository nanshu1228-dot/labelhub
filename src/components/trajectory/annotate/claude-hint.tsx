'use client'

import type { ClaudeHint } from './types'

/**
 * The dashed-border AI suggestion strip rendered under a rubric row.
 *
 * Two actions:
 *   "Use"      — copy Claude's value + reason into the annotator's own mark.
 *   "Override" — collapse the hint and clear it from view (still in DB —
 *                we don't delete pre-annotations; we record that the human
 *                disagreed, which is the teaching signal we sell).
 *
 * Compact by design: this is supporting evidence, not the primary input.
 * The annotator's own mark is always the focal element on the row.
 */

export function ClaudeHintCard({
  hint,
  onUse,
  onOverride,
}: {
  hint: ClaudeHint
  /** Apply Claude's value + reason as the annotator's own answer. */
  onUse: () => void
  /** Collapse the hint without applying. Persistence is upstream. */
  onOverride: () => void
}) {
  const valueLabel =
    typeof hint.value === 'boolean'
      ? hint.value
        ? 'true'
        : 'false'
      : String(hint.value)

  return (
    <div className="claude-hint" role="note">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="who">claude</span>
          <span
            className="mono"
            style={{ fontSize: 10.5, color: 'var(--accent)' }}
          >
            → {valueLabel}
          </span>
        </div>
        <div
          className="ts-12"
          style={{ color: 'var(--mute)', lineHeight: 1.45 }}
        >
          {hint.reason}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          className="act"
          onClick={onUse}
          aria-label="Apply Claude's suggestion"
        >
          use
        </button>
        <button
          type="button"
          className="act"
          onClick={onOverride}
          aria-label="Override and dismiss Claude's suggestion"
        >
          override
        </button>
      </div>
    </div>
  )
}
