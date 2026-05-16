'use client'

import { useState, useTransition } from 'react'
import { getDraftFeedback } from '@/lib/actions/draft-feedback'
import type { DraftReview, DraftWarning } from '@/lib/ai/draft-reviewer'

/**
 * AI 预检 — pre-submission draft sanity check.
 *
 * Renders as a single button below the form's rubric grid. Click →
 * server action calls Claude → inline warnings panel. The warnings
 * panel collapses when the user clicks away or "dismiss"; clicking
 * the button again re-runs the check.
 *
 * Design intent:
 *   - SOFT signal, NEVER a blocker. Submit always works regardless
 *     of warnings — the user is the authority. We're a colleague,
 *     not a gatekeeper.
 *   - Cost is real (Claude call per click), so we throttle on the
 *     server (20s cooldown) and surface that as a polite message.
 *   - Show the model's `summary` even when warnings are empty, so a
 *     "your draft looks solid" outcome still feels like a useful
 *     interaction (justifies the wait).
 */

export function AIPrecheckButton({
  topicId,
  buildDraft,
  disabled,
}: {
  topicId: string
  /** Snapshot of the current form state. We grab it lazily at click
   *  time so we always send the user's latest values. */
  buildDraft: () => Record<string, unknown>
  /** Mirror the form's read-only state — disable AI 预检 if the
   *  topic is past drafting. */
  disabled?: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<DraftReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null)

  function runCheck() {
    if (disabled || isPending) return
    setError(null)
    startTransition(async () => {
      try {
        const r = await getDraftFeedback({
          topicId,
          draft: buildDraft(),
        })
        setResult(r.review)
        setLastRunAt(new Date())
      } catch (e) {
        setResult(null)
        setError(e instanceof Error ? e.message : 'AI 预检 failed.')
      }
    })
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={runCheck}
          disabled={disabled || isPending}
          className="ts-13 mono"
          style={{
            background: 'transparent',
            color: 'var(--accent)',
            border: '1px dashed var(--accent-line)',
            borderRadius: 6,
            padding: '6px 14px',
            cursor: disabled || isPending ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.4 : 1,
          }}
          title="Ask Claude to sanity-check your draft before submitting"
        >
          {isPending ? '🔮 checking…' : '🔮 AI 预检'}
        </button>
        {lastRunAt && !isPending && (
          <span
            className="ts-11 mono"
            style={{ color: 'var(--mute2)' }}
            title={lastRunAt.toISOString()}
          >
            last run · {lastRunAt.toLocaleTimeString(undefined, { hour12: false })}
          </span>
        )}
        {result && !isPending && (
          <button
            type="button"
            onClick={() => setResult(null)}
            className="ts-11 mono"
            style={{
              background: 'transparent',
              color: 'var(--mute2)',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            dismiss
          </button>
        )}
      </div>

      {error && (
        <div
          className="ts-12 mono mt-2 p-2 rounded"
          style={{
            background: 'var(--warn-soft)',
            border: '1px solid oklch(0.6 0.14 75 / 0.4)',
            color: 'oklch(0.55 0.14 75)',
          }}
        >
          {error}
        </div>
      )}

      {result && <PrecheckPanel review={result} />}
    </div>
  )
}

/**
 * Inline panel that renders the model's response. We show the
 * one-line summary at the top in a calm color, then list warnings
 * below ordered by severity. Empty warnings get a "looks solid"
 * confirmation so the user knows the AI ran and approved.
 */
function PrecheckPanel({ review }: { review: DraftReview }) {
  const hasWarnings = review.warnings.length > 0
  return (
    <div
      className="rounded-md mt-2 p-3"
      style={{
        background: hasWarnings ? 'var(--warn-soft)' : 'var(--success-soft)',
        border: `1px solid ${
          hasWarnings
            ? 'oklch(0.6 0.14 75 / 0.4)'
            : 'oklch(0.5 0.13 150 / 0.35)'
        }`,
      }}
    >
      <div className="flex items-baseline gap-2 mb-2">
        <span
          className="lbl"
          style={{
            color: hasWarnings
              ? 'oklch(0.55 0.14 75)'
              : 'oklch(0.45 0.15 150)',
            letterSpacing: '0.05em',
          }}
        >
          § AI 预检 · {hasWarnings ? `${review.warnings.length} 项建议` : '一切就绪'}
        </span>
      </div>
      <p
        className="ts-13"
        style={{
          color: 'var(--text)',
          lineHeight: 1.55,
        }}
      >
        {review.summary}
      </p>
      {hasWarnings && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {review.warnings.map((w, i) => (
            <WarningRow key={i} w={w} />
          ))}
        </ul>
      )}
      <div
        className="ts-11 mono mt-2"
        style={{ color: 'var(--mute2)' }}
      >
        AI suggestion — not a blocker. You can still submit as-is.
      </div>
    </div>
  )
}

function WarningRow({ w }: { w: DraftWarning }) {
  const codeColor: Record<DraftWarning['code'], string> = {
    missing: 'oklch(0.65 0.13 200)',
    thin: 'oklch(0.55 0 0)',
    inconsistent: 'oklch(0.6 0.14 75)',
    drift: 'oklch(0.55 0.2 25)',
    risk: 'oklch(0.55 0.2 25)',
  }
  const color = codeColor[w.code]
  return (
    <li
      className="ts-12 flex items-start gap-2"
      style={{ color: 'var(--text)' }}
    >
      <span
        className="mono ts-11 shrink-0"
        style={{
          color,
          background: `${color}1f`,
          border: `1px solid ${color}66`,
          padding: '1px 6px',
          borderRadius: 3,
          letterSpacing: '0.04em',
          minWidth: 64,
          textAlign: 'center',
          fontWeight: 600,
        }}
      >
        {w.code}
      </span>
      <span>{w.message}</span>
      {w.refId && (
        <span
          className="ts-11 mono ml-auto shrink-0"
          style={{ color: 'var(--mute2)' }}
        >
          ↦ {w.refId}
        </span>
      )}
    </li>
  )
}
