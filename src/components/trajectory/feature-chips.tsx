import type { TrajectoryFeatures } from '@/lib/trajectories/extract-features'

/**
 * Inline feature chips for trajectory list rows. Reads the pre-computed
 * `features` jsonb and emits a compact strip of mono-spaced badges.
 *
 * Pure presentational — takes a loosely-typed input (the row's jsonb
 * field) and parses defensively so old rows without features don't
 * crash. Each chip has a tooltip explaining the metric.
 */

interface FeaturesLike {
  v?: number
  stepCount?: number
  outcome?: 'completed' | 'errored' | 'incomplete'
  toolUsage?: Record<string, number>
  uniqueTools?: number
  loopDetected?: boolean
  errorCount?: number
  durationMs?: number | null
  finalResponseChars?: number
  models?: string[]
}

export function FeatureChips({
  features,
  size = 'sm',
}: {
  features: TrajectoryFeatures | FeaturesLike | null | undefined
  size?: 'sm' | 'md'
}) {
  const f = (features ?? {}) as FeaturesLike
  if (!f.v) return null

  const fontSize = size === 'sm' ? 10 : 11
  const pad = size === 'sm' ? '1px 6px' : '2px 8px'

  const chips: Array<{
    label: string
    title: string
    tone: 'success' | 'danger' | 'warn' | 'accent' | 'mute'
  }> = []

  // Outcome — green/red/yellow
  if (f.outcome === 'completed') {
    chips.push({
      label: '✓ done',
      title: `Agent reached a clean final_response with no errors`,
      tone: 'success',
    })
  } else if (f.outcome === 'errored') {
    chips.push({
      label: `✗ ${f.errorCount ?? 1} error${(f.errorCount ?? 1) === 1 ? '' : 's'}`,
      title: `${f.errorCount ?? 1} step(s) of kind=error`,
      tone: 'danger',
    })
  } else if (f.outcome === 'incomplete') {
    chips.push({
      label: '⋯ incomplete',
      title: 'Trajectory ended without a final_response',
      tone: 'warn',
    })
  }

  // Loop heuristic — violet alarm
  if (f.loopDetected) {
    chips.push({
      label: '🔁 loop',
      title: 'Same tool+args repeated ≥3 times within a 10-step window',
      tone: 'warn',
    })
  }

  // Tool usage compact
  if ((f.uniqueTools ?? 0) > 0) {
    const top = topTool(f.toolUsage)
    chips.push({
      label: top
        ? `${f.uniqueTools} tools · ${top.name}×${top.count}`
        : `${f.uniqueTools} tools`,
      title: top
        ? `${f.uniqueTools} distinct tools called; most used: ${top.name} (${top.count}×)`
        : `${f.uniqueTools} distinct tools called`,
      tone: 'mute',
    })
  }

  // Duration
  if (typeof f.durationMs === 'number' && f.durationMs > 0) {
    chips.push({
      label: formatDuration(f.durationMs),
      title: `Wall-clock first-step → last-step`,
      tone: 'mute',
    })
  }

  if (chips.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {chips.map((c, i) => (
        <span
          key={i}
          title={c.title}
          className="mono shrink-0"
          style={{
            ...toneStyle(c.tone),
            borderRadius: 4,
            padding: pad,
            fontSize,
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            fontWeight: c.tone === 'success' || c.tone === 'danger' ? 600 : 500,
          }}
        >
          {c.label}
        </span>
      ))}
    </div>
  )
}

function toneStyle(tone: 'success' | 'danger' | 'warn' | 'accent' | 'mute'): {
  background: string
  color: string
  border: string
} {
  switch (tone) {
    case 'success':
      return {
        background: 'var(--success-soft)',
        color: 'var(--success)',
        border: '1px solid oklch(0.5 0.13 150 / 0.4)',
      }
    case 'danger':
      return {
        background: 'var(--danger-soft)',
        color: 'var(--danger)',
        border: '1px solid oklch(0.55 0.2 25 / 0.4)',
      }
    case 'warn':
      return {
        background: 'oklch(0.7 0.14 75 / 0.08)',
        color: 'var(--warn)',
        border: '1px solid oklch(0.7 0.14 75 / 0.4)',
      }
    case 'accent':
      return {
        background: 'var(--accent-soft)',
        color: 'var(--accent)',
        border: '1px solid var(--accent-line)',
      }
    case 'mute':
      return {
        background: 'var(--panel2)',
        color: 'var(--mute)',
        border: '1px solid var(--line)',
      }
  }
}

function topTool(
  usage: Record<string, number> | undefined,
): { name: string; count: number } | null {
  if (!usage) return null
  let best: { name: string; count: number } | null = null
  for (const [name, count] of Object.entries(usage)) {
    if (!best || count > best.count) best = { name, count }
  }
  return best
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`
}
