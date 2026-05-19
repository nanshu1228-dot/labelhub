'use client'

import { useEffect, useState } from 'react'

/**
 * Phase-19 live activity strip on the workspace dashboard.
 *
 * Polls /api/workspaces/[id]/recent-events every 5 seconds and renders
 * the last 20 events as a horizontally-scrolling marquee strip. New
 * events fade in from the left.
 *
 * Why polling, not SSE: this is a "is anyone here?" signal, not an
 * orderbook. 5s latency is plenty; SSE would add a stream-state graph
 * for no UX gain.
 *
 * Falls back to a static "no recent activity" hint when the fetch
 * fails or returns empty.
 */
interface ActivityEvent {
  id: string
  ts: string
  type: string
  actor: string | null
}

const POLL_MS = 5000
const LIMIT = 20

export function LiveActivityStrip({
  workspaceId,
}: {
  workspaceId: string
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [stale, setStale] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      // Skip polling when the tab is hidden — a forgotten dashboard
      // tab used to hit /recent-events every 5s indefinitely (3rd
      // bug hunt #11). On visibility return, the visibilitychange
      // listener below kicks one fresh poll.
      if (
        typeof document !== 'undefined' &&
        document.visibilityState !== 'visible'
      ) {
        return
      }
      try {
        const r = await fetch(
          `/api/workspaces/${workspaceId}/recent-events?limit=${LIMIT}`,
          { cache: 'no-store' },
        )
        if (!r.ok) {
          if (!cancelled) setStale(true)
          return
        }
        const j: { events: ActivityEvent[] } = await r.json()
        if (cancelled) return
        setEvents(j.events ?? [])
        setStale(false)
      } catch {
        if (!cancelled) setStale(true)
      }
    }
    poll()
    const iv = setInterval(poll, POLL_MS)
    function onVisChange() {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      ) {
        poll()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisChange)
    }
    return () => {
      cancelled = true
      clearInterval(iv)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisChange)
      }
    }
  }, [workspaceId])

  if (events.length === 0 && !stale) {
    return null // hide on first paint; reappears once data arrives
  }
  return (
    <div
      className="rounded-md p-3 mb-4 overflow-hidden"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <span
          className="lbl"
          style={{ color: 'var(--mute)' }}
        >
          § LIVE ACTIVITY
        </span>
        <span
          className="ts-11 mono inline-flex items-center gap-1.5"
          style={{ color: stale ? 'var(--danger)' : 'var(--mute2)' }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: stale
                ? 'var(--danger)'
                : 'oklch(0.7 0.18 145)',
              animation: stale ? undefined : 'pulse 2s infinite',
            }}
          />
          {stale ? 'paused' : `polling · ${POLL_MS / 1000}s`}
        </span>
      </div>
      <div
        className="overflow-x-auto pb-1"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div className="flex items-center gap-2 min-w-max">
          {events.slice(0, LIMIT).map((e) => (
            <EventChip key={e.id} event={e} />
          ))}
        </div>
      </div>
    </div>
  )
}

function EventChip({ event }: { event: ActivityEvent }) {
  const color = colorForType(event.type)
  return (
    <span
      className="ts-11 mono px-2 py-1 rounded inline-flex items-center gap-1.5 shrink-0"
      style={{
        background: 'var(--bg)',
        border: `1px solid ${color}33`,
        color,
      }}
      title={`${event.type} · ${new Date(event.ts).toLocaleString()}`}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: color }}
      />
      <span style={{ color: 'var(--mute2)' }}>
        {formatRel(event.ts)}
      </span>
      <span style={{ color: 'var(--text)' }}>
        {shortType(event.type)}
      </span>
      {event.actor && (
        <span style={{ color: 'var(--mute)' }}>
          · {event.actor}
        </span>
      )}
    </span>
  )
}

function shortType(t: string): string {
  // 'annotation.approved' → 'approved'
  // 'invite_reward.granted' → 'reward'
  // 'dataset.version_frozen' → 'version frozen'
  if (t.startsWith('annotation.')) return t.slice('annotation.'.length)
  if (t.startsWith('invite_reward.')) return `reward ${t.split('.')[1]}`
  if (t.startsWith('dataset.'))
    return t.slice('dataset.'.length).replace(/_/g, ' ')
  if (t.startsWith('llm_judge.')) return `judge ${t.split('.')[1]}`
  if (t.startsWith('ds.')) return 'DS run'
  if (t.startsWith('workspace.')) return t.slice('workspace.'.length)
  return t
}

function colorForType(t: string): string {
  if (t.includes('approved') || t.includes('granted'))
    return 'oklch(0.65 0.18 200)'
  if (t.includes('rejected') || t.includes('blocked'))
    return 'oklch(0.55 0.2 25)'
  if (t.includes('revised') || t.includes('review'))
    return 'oklch(0.55 0.14 75)'
  if (t.startsWith('ds.') || t.startsWith('llm_judge.'))
    return 'oklch(0.55 0.18 320)'
  if (t.startsWith('dataset.')) return 'oklch(0.55 0.15 230)'
  return 'oklch(0.55 0 0)'
}

function formatRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  return `${day}d`
}
