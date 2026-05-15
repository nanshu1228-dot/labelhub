import type { QualityTrendBucket } from '@/lib/queries/quality-trend'

/**
 * Quality Trend sparkline — server-renderable (no client JS, pure SVG).
 *
 * Plots weekly approval rate as a line + dot-per-week. Empty weeks
 * (sampleSize=0) are drawn lighter so they don't pretend to be data.
 * Tooltip on hover via the SVG <title> child element — works without
 * any extra runtime.
 *
 * This is the "flywheel" visual for the demo — it answers "is the
 * workspace's quality trending up?" in one glance. Looks good on
 * /quality and on the workspace landing dashboard.
 */
export function QualityTrendPanel({
  buckets,
}: {
  buckets: QualityTrendBucket[]
}) {
  if (buckets.length === 0) {
    return null
  }
  // Empty when no actual reviews happened anywhere in the window —
  // render a placeholder so the layout doesn't shift on first-week
  // demos.
  const hasAnyData = buckets.some((b) => b.sampleSize > 0)

  const W = 720
  const H = 120
  const PAD_L = 36
  const PAD_R = 16
  const PAD_T = 16
  const PAD_B = 24
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  const n = buckets.length
  const xFor = (i: number) =>
    PAD_L + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const yFor = (rate: number) => PAD_T + innerH - rate * innerH

  // Y-axis ticks at 0 / 0.5 / 1.
  const yTicks = [0, 0.5, 1]

  const points = buckets.map((b, i) => ({
    x: xFor(i),
    y: yFor(b.approvalRate),
    rate: b.approvalRate,
    sample: b.sampleSize,
    week: b.weekStart,
  }))

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')

  const fmtWeek = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

  // Trend summary: compare last 4 weeks' average to prior 4.
  const trend = (() => {
    if (n < 8) return null
    const recent = buckets.slice(-4)
    const prior = buckets.slice(-8, -4)
    const recAvg =
      recent.reduce((s, b) => s + b.approvalRate, 0) / recent.length
    const priAvg =
      prior.reduce((s, b) => s + b.approvalRate, 0) / prior.length
    const delta = recAvg - priAvg
    if (Math.abs(delta) < 0.02) return { dir: 'flat' as const, delta }
    return { dir: delta > 0 ? ('up' as const) : ('down' as const), delta }
  })()

  const trendColor =
    trend?.dir === 'up'
      ? 'oklch(0.65 0.18 200)'
      : trend?.dir === 'down'
        ? 'oklch(0.55 0.2 25)'
        : 'var(--mute)'

  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <div className="lbl">§ QUALITY TREND · APPROVAL RATE (weekly)</div>
        {trend && (
          <div
            className="ts-12 mono"
            style={{ color: trendColor, fontWeight: 600 }}
          >
            {trend.dir === 'up'
              ? '↑'
              : trend.dir === 'down'
                ? '↓'
                : '→'}{' '}
            {trend.delta >= 0 ? '+' : ''}
            {(trend.delta * 100).toFixed(1)}% vs prior 4 weeks
          </div>
        )}
      </div>
      <div
        className="rounded-md p-3"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        {!hasAnyData ? (
          <p
            className="ts-12 mono py-6 text-center"
            style={{ color: 'var(--mute2)' }}
          >
            No reviewed annotations in the last {n} weeks — trend kicks
            in once admin starts accepting/rejecting work.
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            preserveAspectRatio="xMidYMid meet"
            aria-label="Weekly approval-rate trend"
          >
            {/* Y axis grid */}
            {yTicks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD_L}
                  x2={W - PAD_R}
                  y1={yFor(t)}
                  y2={yFor(t)}
                  stroke="var(--line)"
                  strokeDasharray={t === 0.5 ? '2 2' : undefined}
                  strokeWidth={t === 0 || t === 1 ? 1 : 0.5}
                />
                <text
                  x={PAD_L - 8}
                  y={yFor(t) + 3}
                  textAnchor="end"
                  fontSize="10"
                  fontFamily="var(--font-geist-mono), monospace"
                  fill="var(--mute2)"
                >
                  {Math.round(t * 100)}%
                </text>
              </g>
            ))}

            {/* Line + dots */}
            <path
              d={linePath}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.map((p) => (
              <g key={p.x}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={p.sample > 0 ? 3.5 : 2}
                  fill={p.sample > 0 ? 'var(--accent)' : 'var(--mute2)'}
                  stroke="var(--bg)"
                  strokeWidth="1"
                >
                  <title>
                    week of {fmtWeek(p.week)}
                    {'\n'}
                    approval rate: {(p.rate * 100).toFixed(1)}%
                    {'\n'}
                    reviewed: {p.sample}
                  </title>
                </circle>
              </g>
            ))}

            {/* X axis ticks: first / middle / last */}
            {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
              <text
                key={i}
                x={xFor(i)}
                y={H - 6}
                textAnchor="middle"
                fontSize="9"
                fontFamily="var(--font-geist-mono), monospace"
                fill="var(--mute2)"
              >
                {fmtWeek(buckets[i].weekStart)}
              </text>
            ))}
          </svg>
        )}
      </div>
    </section>
  )
}
