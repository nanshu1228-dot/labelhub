import type { TrajectorySummary } from '@/lib/ai/trajectory-summarizer'
import { FeatureChips } from './feature-chips'
import type { TrajectoryFeatures } from '@/lib/trajectories/extract-features'

/**
 * AI-generated trajectory summary card. Shows on the trajectory detail
 * page so admins can read 200 words instead of scrolling 1000 steps.
 *
 * Two visual states:
 *   - summary present  → paragraph + pattern badge + keyword chips +
 *                        feature chips (counts/outcome)
 *   - summary missing  → small "summary pending — scheduled in background"
 *                        placeholder so the layout doesn't jump
 *
 * Pure presentational; the page fetches both `summary` and `features`
 * and passes them in.
 */
export function SummaryCard({
  summary,
  features,
  summaryAt,
  summaryModel,
}: {
  summary: TrajectorySummary | null
  features: TrajectoryFeatures | null
  summaryAt: Date | null
  summaryModel: string | null
}) {
  if (!summary) {
    return (
      <div
        className="rounded-xl p-4"
        style={{
          background: 'var(--panel)',
          border: '1px dashed var(--line2)',
        }}
      >
        <div className="lbl mb-1.5">§ AI SUMMARY</div>
        <p className="ts-13" style={{ color: 'var(--mute)' }}>
          Summary pending — scheduled in the background. Refresh in a few
          seconds, or hit{' '}
          <span className="mono ts-11" style={{ color: 'var(--accent)' }}>
            POST /api/admin/compute-hints
          </span>{' '}
          to force compute now.
        </p>
      </div>
    )
  }
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'linear-gradient(135deg, var(--panel), oklch(0.98 0.01 280))',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-2">
          <div className="lbl">§ AI SUMMARY</div>
          <PatternBadge pattern={summary.pattern} />
        </div>
        {summaryAt && (
          <span
            className="ts-11 mono"
            style={{ color: 'var(--mute2)' }}
            title={summaryModel ?? ''}
          >
            {summaryAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
          </span>
        )}
      </div>

      <p
        className="ts-13 mb-3"
        style={{ color: 'var(--text)', lineHeight: 1.6 }}
      >
        {summary.summary}
      </p>

      {summary.keywords.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {summary.keywords.map((k) => (
            <span
              key={k}
              className="mono"
              style={{
                fontSize: 10,
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                border: '1px solid var(--accent-line)',
                borderRadius: 4,
                padding: '1px 6px',
                letterSpacing: '0.02em',
              }}
            >
              #{k}
            </span>
          ))}
        </div>
      )}

      {features && (
        <FeatureChips features={features} size="sm" />
      )}
    </div>
  )
}

function PatternBadge({ pattern }: { pattern: TrajectorySummary['pattern'] }) {
  const palette: Record<
    TrajectorySummary['pattern'],
    { bg: string; fg: string; bord: string; label: string }
  > = {
    'direct-and-clean': {
      bg: 'var(--success-soft)',
      fg: 'var(--success)',
      bord: 'oklch(0.5 0.13 150 / 0.4)',
      label: 'direct & clean',
    },
    'iterative-clarifying': {
      bg: 'var(--accent-soft)',
      fg: 'var(--accent)',
      bord: 'var(--accent-line)',
      label: 'iterative',
    },
    'looped-on-tool': {
      bg: 'oklch(0.7 0.14 75 / 0.08)',
      fg: 'var(--warn)',
      bord: 'oklch(0.7 0.14 75 / 0.4)',
      label: 'tool loop',
    },
    'errored-early': {
      bg: 'var(--danger-soft)',
      fg: 'var(--danger)',
      bord: 'oklch(0.55 0.2 25 / 0.4)',
      label: 'errored early',
    },
    'over-thinking': {
      bg: 'oklch(0.94 0.04 280)',
      fg: 'oklch(0.45 0.15 280)',
      bord: 'oklch(0.6 0.15 280 / 0.3)',
      label: 'over-thinking',
    },
    'minimal-tool-use': {
      bg: 'var(--panel2)',
      fg: 'var(--mute)',
      bord: 'var(--line)',
      label: 'minimal tools',
    },
    'parallel-exploration': {
      bg: 'oklch(0.94 0.04 200)',
      fg: 'oklch(0.45 0.15 200)',
      bord: 'oklch(0.6 0.15 200 / 0.3)',
      label: 'parallel',
    },
    other: {
      bg: 'var(--panel2)',
      fg: 'var(--mute)',
      bord: 'var(--line)',
      label: 'other',
    },
  }
  const v = palette[pattern]
  return (
    <span
      className="mono shrink-0"
      style={{
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.bord}`,
        borderRadius: 4,
        padding: '1px 8px',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {v.label}
    </span>
  )
}
