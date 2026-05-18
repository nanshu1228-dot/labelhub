'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { DEMO_WORKSPACE_ID } from '@/lib/seeds'

/**
 * Lightweight onboarding tour overlay (Phase-17 17b).
 *
 * No third-party tour library — a single sticky card in the bottom-
 * right corner advances the visitor through 6 stops on the demo
 * workspace. Mount once in the root layout; the component reads the
 * current pathname and surfaces the matching step.
 *
 * State: localStorage `lh.tour.state` = `'done'` (dismissed forever)
 * | `'step:N'` (current step index 0-5). Empty / missing = step 0.
 *
 * The card never auto-shows on /signin, /signup, or admin-only routes
 * a fresh visitor can't reach. Showing only on stop pages means the
 * visitor isn't bothered when they wander elsewhere.
 */

const DEMO_WS = DEMO_WORKSPACE_ID
const STORAGE_KEY = 'lh.tour.state'

interface Stop {
  id: string
  /** Pathname matcher — startsWith semantics. */
  matchPrefix: string
  /** Human label of where they are right now. */
  hereLabel: string
  /** Tooltip body (under-1-line). */
  body: string
  /** Where the "next" button takes them, plus its label. */
  nextHref: string | null
  nextLabel: string | null
}

const STOPS: Stop[] = [
  {
    id: 'landing',
    matchPrefix: '/',
    hereLabel: '01 · Landing',
    body: 'The gateway thesis lives here. Hit Next to enter the live demo workspace.',
    nextHref: `/workspaces/${DEMO_WS}`,
    nextLabel: '→ Enter demo workspace',
  },
  {
    id: 'workspace',
    matchPrefix: `/workspaces/${DEMO_WS}`,
    hereLabel: '02 · Workspace',
    body: 'Pre-seeded: 3 raters, 5 trajectories, a real IAA dispute. Look at the trajectories list.',
    nextHref: `/workspaces/${DEMO_WS}/trajectories`,
    nextLabel: '→ Trajectories',
  },
  {
    id: 'trajectories',
    matchPrefix: `/workspaces/${DEMO_WS}/trajectories`,
    hereLabel: '03 · Trajectories',
    body: 'Each row is one captured agent run. Three layouts — try Compare on any pair.',
    nextHref: `/workspaces/${DEMO_WS}/quality`,
    nextLabel: '→ Quality dashboard',
  },
  {
    id: 'quality',
    matchPrefix: `/workspaces/${DEMO_WS}/quality`,
    hereLabel: '04 · Quality',
    body: 'Dawid-Skene truth, per-rater trust, IAA. Run DS to see latent labels emerge.',
    nextHref: `/workspaces/${DEMO_WS}/analyze`,
    nextLabel: '→ Analyze',
  },
  {
    id: 'analyze',
    matchPrefix: `/workspaces/${DEMO_WS}/analyze`,
    hereLabel: '05 · Analyze',
    body: 'Filter trajectories, ask Claude questions over the matched set. Aggregate behavior patterns.',
    nextHref: `/workspaces/${DEMO_WS}/settings`,
    nextLabel: '→ Settings',
  },
  {
    id: 'settings',
    matchPrefix: `/workspaces/${DEMO_WS}/settings`,
    hereLabel: '06 · Settings',
    body: 'Freeze a dataset version — manifest is JSONL, ready for SFT/DPO. End of tour.',
    nextHref: null,
    nextLabel: null,
  },
]

// Routes where the tour MUST stay hidden (auth flows + cross-cutting
// admin pages). On these the card just won't render.
const HIDE_ON: string[] = ['/signin', '/signup', '/admin']

function findStop(pathname: string): Stop | null {
  // Pick the most-specific match — exact > prefix.
  let best: Stop | null = null
  for (const s of STOPS) {
    if (s.matchPrefix === '/' && pathname !== '/') continue
    if (pathname === s.matchPrefix || pathname.startsWith(s.matchPrefix + '/')) {
      if (!best || s.matchPrefix.length > best.matchPrefix.length) best = s
    }
  }
  if (!best && pathname === '/') return STOPS[0]
  return best
}

export function OnboardingTour() {
  const pathname = usePathname()
  const router = useRouter()
  const [dismissed, setDismissed] = useState<boolean>(true) // start hidden until effect reads localStorage
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
    try {
      const v = window.localStorage.getItem(STORAGE_KEY)
      setDismissed(v === 'done')
    } catch {
      // SSR / no localStorage — keep dismissed=true to avoid flicker
    }
  }, [])

  if (!hydrated || dismissed) return null
  if (HIDE_ON.some((p) => pathname.startsWith(p))) return null

  const stop = findStop(pathname)
  if (!stop) return null

  const stopIndex = STOPS.findIndex((s) => s.id === stop.id)

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'done')
    } catch {
      // ignore
    }
    setDismissed(true)
  }

  function next() {
    if (!stop?.nextHref) {
      dismiss()
      return
    }
    router.push(stop.nextHref as `/${string}`)
  }

  return (
    <div
      className="fixed bottom-5 right-5 z-[60]"
      style={{ maxWidth: 360 }}
      role="dialog"
      aria-label="Onboarding tour"
    >
      <div
        className="rounded-lg shadow-2xl"
        style={{
          background: 'oklch(0.13 0 0)',
          border: '1px solid oklch(0.3 0.08 280)',
          boxShadow:
            '0 0 0 1px oklch(0.55 0.2 280 / 0.2), 0 20px 50px oklch(0 0 0 / 0.6)',
        }}
      >
        <div
          className="px-4 py-2 flex items-center justify-between"
          style={{
            borderBottom: '1px solid oklch(0.22 0 0)',
          }}
        >
          <span
            className="lh-mono lh-caption"
            style={{ color: 'oklch(0.6 0.18 280)' }}
          >
            § TOUR · {stop.hereLabel}
          </span>
          <button
            type="button"
            onClick={dismiss}
            className="lh-mono lh-caption"
            style={{
              background: 'transparent',
              color: 'oklch(0.5 0 0)',
              border: 'none',
              cursor: 'pointer',
            }}
            aria-label="Dismiss tour"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-3">
          <p
            className="lh-body-sm"
            style={{ color: 'oklch(0.86 0 0)' }}
          >
            {stop.body}
          </p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div
              className="flex gap-1"
              aria-label="Tour progress"
            >
              {STOPS.map((s, i) => (
                <span
                  key={s.id}
                  className="inline-block h-1 rounded-full"
                  style={{
                    width: i === stopIndex ? 18 : 8,
                    background:
                      i <= stopIndex
                        ? 'oklch(0.6 0.18 280)'
                        : 'oklch(0.28 0 0)',
                  }}
                />
              ))}
            </div>
            {stop.nextHref ? (
              <button
                type="button"
                onClick={next}
                className="lh-mono lh-caption px-3 py-1 rounded"
                style={{
                  background: 'oklch(0.6 0.18 280)',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {stop.nextLabel}
              </button>
            ) : (
              <button
                type="button"
                onClick={dismiss}
                className="lh-mono lh-caption px-3 py-1 rounded"
                style={{
                  background: 'oklch(0.22 0 0)',
                  color: 'oklch(0.86 0 0)',
                  border: '1px solid oklch(0.3 0 0)',
                  cursor: 'pointer',
                }}
              >
                ✓ Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
