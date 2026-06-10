'use client'

import { useState, useTransition } from 'react'
import { requestCoachFeedback } from '@/lib/actions/trust-coach'
import type { CoachFeedback } from '@/lib/ai/trust-coach'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * AI Coach trigger on /my/quality. The big innovation here:
 * production annotation platforms show NUMBERS — we show a personal
 * coaching note. Claude reads the rater's weak axes + recent
 * rejection feedback and writes a private one-page note: greeting +
 * up to 3 specific issues with grounded examples + an encouragement
 * close.
 *
 * UX:
 *   - One button per workspace card
 *   - Click → server action → modal-style panel slides in below
 *   - 60s cooldown on the server (Sonnet calls are expensive)
 *   - Failure: friendly error inline; the user can still see their
 *     stats / trend / feedback above
 */
export function CoachButton({ workspaceId }: { workspaceId: string }) {
  const [feedback, setFeedback] = useState<CoachFeedback | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run() {
    setError(null)
    startTransition(async () => {
      try {
        const r = await requestCoachFeedback({ workspaceId })
        setFeedback(r.feedback)
      } catch (e) {
        setError(getErrorMessage(e, 'Coach failed.'))
      }
    })
  }

  return (
    <div className="flex-1 flex flex-col items-end gap-2 min-w-[140px]">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="ts-13 mono inline-flex items-center gap-2"
        style={{
          background: 'var(--accent)',
          color: 'white',
          border: '1px solid var(--accent)',
          borderRadius: 6,
          padding: '6px 14px',
          fontWeight: 500,
          cursor: pending ? 'not-allowed' : 'pointer',
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? 'thinking…' : '🪄 ask AI Coach'}
      </button>
      {error && (
        <div
          className="ts-12 mono w-full p-2 rounded"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}
      {feedback && <CoachPanel feedback={feedback} />}
    </div>
  )
}

function CoachPanel({ feedback }: { feedback: CoachFeedback }) {
  return (
    <div
      className="w-full rounded-md p-4 mt-2"
      style={{
        background:
          'linear-gradient(135deg, var(--accent-soft), oklch(0.95 0.04 280 / 0.4))',
        border: '1px solid var(--accent-line)',
      }}
    >
      <div className="lbl mb-2" style={{ color: 'var(--accent)' }}>
        § AI COACH · ONE-PAGE NOTE
      </div>
      <p
        className="ts-14 mb-3"
        style={{ color: 'var(--hi)', lineHeight: 1.5 }}
      >
        {feedback.greeting}
      </p>
      {feedback.issues.length > 0 ? (
        <ol className="flex flex-col gap-3 mb-3">
          {feedback.issues.map((it, i) => (
            <li
              key={i}
              className="rounded-md p-3"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
              }}
            >
              <div
                className="ts-13 mb-1"
                style={{ color: 'var(--hi)', fontWeight: 600 }}
              >
                {i + 1}. {it.title}
              </div>
              <div
                className="ts-13 mb-2"
                style={{ color: 'var(--text)' }}
              >
                <span
                  className="lbl mr-1"
                  style={{ color: 'var(--mute2)' }}
                >
                  observed:
                </span>
                {it.observation}
              </div>
              <div
                className="ts-13"
                style={{ color: 'var(--text)' }}
              >
                <span
                  className="lbl mr-1"
                  style={{ color: 'var(--accent)' }}
                >
                  try:
                </span>
                {it.suggestion}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p
          className="ts-13 mb-3"
          style={{ color: 'var(--mute)' }}
        >
          Nothing specific to call out right now — keep going.
        </p>
      )}
      <p
        className="ts-13"
        style={{ color: 'var(--text)', fontStyle: 'italic' }}
      >
        {feedback.encouragement}
      </p>
      <p
        className="ts-11 mono mt-3"
        style={{ color: 'var(--mute2)' }}
      >
        AI-generated · private to you · refresh every 60 seconds
      </p>
    </div>
  )
}
