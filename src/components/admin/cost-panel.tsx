import type { CostSummary } from '@/lib/queries/admin-costs'

/**
 * Platform-cost dashboard panel for /admin (Phase-19).
 *
 * Server-rendered. Shows today + 7d totals on a strip, then per-
 * workspace and per-feature breakdowns side by side. Cost figures
 * read straight from ai_call_log.cost_usd (populated by logAICall).
 *
 * The "$0.00 today" empty state is honest signal — when admins see
 * zero, it usually means the day just started, not a broken pipeline.
 */
export function CostPanel({
  today,
  last7d,
}: {
  today: CostSummary
  last7d: CostSummary
}) {
  return (
    <section className="mb-8">
      <div className="lbl mb-2">§ PLATFORM COST</div>
      <h2
        className="ts-22 mb-3"
        style={{ color: 'var(--hi)', fontWeight: 500 }}
      >
        AI spend across your workspaces
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Tile
          label="today · cost"
          value={formatUsd(today.totalCostUsd)}
          tone="accent"
        />
        <Tile
          label="today · calls"
          value={today.totalCalls.toLocaleString()}
          tone="muted"
        />
        <Tile
          label="7 days · cost"
          value={formatUsd(last7d.totalCostUsd)}
          tone="accent"
        />
        <Tile
          label="7 days · tokens"
          value={`${(
            (last7d.totalTokensIn + last7d.totalTokensOut) /
            1000
          ).toFixed(1)}k`}
          tone="muted"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Breakdown
          title="BY WORKSPACE (7d)"
          rows={last7d.byWorkspace.slice(0, 8).map((r) => ({
            label: r.workspaceName,
            cost: r.costUsd,
            calls: r.calls,
            total: last7d.totalCostUsd,
          }))}
        />
        <Breakdown
          title="BY FEATURE (7d)"
          rows={last7d.byFeature.slice(0, 8).map((r) => ({
            label: r.feature,
            cost: r.costUsd,
            calls: r.calls,
            total: last7d.totalCostUsd,
          }))}
        />
      </div>
    </section>
  )
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'accent' | 'muted'
}) {
  const fg = tone === 'accent' ? 'var(--accent)' : 'var(--text)'
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div
        className="lbl mb-1"
        style={{ color: 'var(--mute2)' }}
      >
        {label}
      </div>
      <div
        className="ts-22 mono"
        style={{ color: fg, fontWeight: 600 }}
      >
        {value}
      </div>
    </div>
  )
}

function Breakdown({
  title,
  rows,
}: {
  title: string
  rows: Array<{
    label: string
    cost: number
    calls: number
    total: number
  }>
}) {
  return (
    <div
      className="rounded-md p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="lbl mb-3" style={{ color: 'var(--mute)' }}>
        {title}
      </div>
      {rows.length === 0 ? (
        <div
          className="ts-12 mono py-3"
          style={{ color: 'var(--mute2)' }}
        >
          No spend in this window.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const pct = r.total > 0 ? r.cost / r.total : 0
            return (
              <li key={r.label}>
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className="ts-13 truncate"
                    style={{ color: 'var(--text)' }}
                  >
                    {r.label}
                  </span>
                  <span
                    className="ts-12 mono shrink-0"
                    style={{ color: 'var(--mute)' }}
                  >
                    {formatUsd(r.cost)}{' '}
                    <span style={{ color: 'var(--mute2)' }}>
                      · {r.calls}
                    </span>
                  </span>
                </div>
                <div
                  className="mt-1 h-1 rounded-full overflow-hidden"
                  style={{ background: 'var(--bg)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, Math.round(pct * 100))}%`,
                      background: 'oklch(0.6 0.18 280)',
                    }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function formatUsd(n: number): string {
  if (n < 0.01 && n > 0) return '<$0.01'
  if (n < 1) return `$${n.toFixed(4)}`
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${n.toFixed(0)}`
}
