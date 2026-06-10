import type { ReactNode } from 'react'

/**
 * Shared stat / metric card — the `label + icon + big value` tile that tops
 * almost every dashboard (`/admin/forms`, `/admin/exports`, `/review`,
 * task detail …). Each of those pages had hand-rolled an identical local
 * `StatCard` with its own tone enum; they only differed in *which* tones
 * they happened to use, never in layout or palette. This is the single
 * source of truth so the tones can't drift apart.
 *
 * Layout (pinned, matches the existing tiles exactly):
 *   ┌──────────────────────────────┐
 *   │ LABEL (mono caps)      <icon> │   ← icon tinted by `tone`
 *   │                              │
 *   │ 1,234  (big value)           │
 *   │ optional hint                │
 *   └──────────────────────────────┘
 *
 * The icon is the only tinted element; the value is always `var(--hi)` and
 * the label always `var(--mute2)`, exactly as every call site rendered it.
 *
 * Pure server-renderable. Use from .tsx pages without `'use client'`.
 */

/**
 * Canonical tone enum. Maps to the shared `var(--*)` palette so every stat
 * tile draws from the same colors. `default` is the un-tinted neutral icon.
 */
export type StatCardTone =
  | 'default'
  | 'accent'
  | 'success'
  | 'warn'
  | 'danger'
  | 'muted'

const TONE_COLOR: Record<StatCardTone, string> = {
  default: 'var(--mute)',
  accent: 'var(--accent)',
  success: 'var(--success)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  muted: 'var(--mute2)',
}

export interface StatCardProps {
  /** Small mono caps eyebrow ("WORKSPACES", "AWAITING"). */
  label: string
  /** The big metric value — pre-formatted by the caller. */
  value: string
  /** Right-aligned icon, tinted by `tone`. */
  icon: ReactNode
  /** Tone of the icon tint. Defaults to the neutral `default`. */
  tone?: StatCardTone
  /** Optional sub-line below the value (e.g. "12 imported items"). */
  hint?: string
}

export function StatCard({
  label,
  value,
  icon,
  tone = 'default',
  hint,
}: StatCardProps) {
  return (
    <div
      className="rounded p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        minHeight: 104,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="lh-mono lh-caption" style={{ color: 'var(--mute2)' }}>
          {label}
        </div>
        <span style={{ color: TONE_COLOR[tone] }}>{icon}</span>
      </div>
      <div className="ts-24 mt-3" style={{ color: 'var(--hi)', fontWeight: 560 }}>
        {value}
      </div>
      {hint && (
        <div className="ts-12 mt-1" style={{ color: 'var(--mute2)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}
