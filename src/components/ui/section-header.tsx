/**
 * Shared section header — a `§ TITLE` label with an optional right-aligned
 * hint. Six pages defined their own identical copy; this is the single
 * source of truth.
 *
 * Pure server-renderable — use from .tsx pages without `'use client'`.
 */
export function SectionHeader({
  title,
  hint,
}: {
  title: string
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <div className="lbl">§ {title}</div>
      {hint && (
        <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}
