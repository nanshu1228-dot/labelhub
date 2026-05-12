'use client'
import { useRef, useState, useTransition } from 'react'
import { markStepDemo } from '@/lib/actions/step-annotations-demo'

/**
 * Per-step annotation widget.
 *
 * The Likert mapping for step_quality is hand-tuned for an LLM-agent context:
 *   rating 1 → ✗ wrong          (model made a clearly bad call here)
 *   rating 3 → ⚠ suspicious     (defensible but not optimal)
 *   rating 5 → ✓ correct        (model nailed this step)
 *
 * UX:
 *   1. Click a rating button → reasoning textarea slides in beneath
 *   2. Type a reason → "Save" enables (or auto-saves on blur after 500ms)
 *   3. Persisted state shows the current rating + reasoning, with an "Edit"
 *      affordance to switch
 *   4. Errors render inline; clicking a button while pending re-fires
 *
 * Why an uncontrolled textarea (`useRef`): keystrokes on a long-rendered list
 * absolutely must not re-render every sibling step. This is the same rule
 * the Pillar-4 perf budget enforces for annotation grids — see AGENTS.md.
 *
 * Demo-mode caveat: writes go through `markStepDemo` which asserts
 * LABELHUB_DEMO_MODE=true on the server. Without that env, the click errors
 * out with a 403 — by design.
 */

type Rating = 1 | 3 | 5

interface ExistingMark {
  id: string
  rating: number | null
  reasoning: string
}

export interface StepMarkWidgetProps {
  workspaceId: string
  trajectoryStepId: string
  /** Optional existing annotation (so the widget hydrates with what's saved). */
  existing?: ExistingMark | null
}

const RATING_DEFS: Array<{
  value: Rating
  label: string
  icon: string
  color: string
}> = [
  { value: 5, label: 'correct', icon: '✓', color: 'var(--success)' },
  { value: 3, label: 'suspicious', icon: '⚠', color: 'var(--warn)' },
  { value: 1, label: 'wrong', icon: '✗', color: 'var(--danger)' },
]

export function StepMarkWidget({
  workspaceId,
  trajectoryStepId,
  existing,
}: StepMarkWidgetProps) {
  const [rating, setRating] = useState<Rating | null>(
    existing?.rating != null ? (existing.rating as Rating) : null,
  )
  const [savedReasoning, setSavedReasoning] = useState<string>(
    existing?.reasoning ?? '',
  )
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(!existing)
  const reasoningRef = useRef<HTMLTextAreaElement>(null)

  const submit = (chosenRating: Rating) => {
    const reasoning = reasoningRef.current?.value.trim() ?? ''
    if (reasoning.length === 0) {
      setError('Add a one-line reason before saving.')
      reasoningRef.current?.focus()
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await markStepDemo({
          workspaceId,
          trajectoryStepId,
          kind: 'step_quality',
          rating: chosenRating,
          reasoning,
        })
        setRating(chosenRating)
        setSavedReasoning(reasoning)
        setEditing(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed.')
      }
    })
  }

  // Saved state: show the rating + reasoning compactly with an Edit affordance.
  if (!editing && rating != null) {
    const def = RATING_DEFS.find((r) => r.value === rating)!
    return (
      <div
        className="rounded-md px-3 py-2 flex items-start gap-2"
        style={{
          background: 'var(--panel2)',
          border: '1px solid var(--line)',
        }}
      >
        <span
          className="ts-13 mono"
          style={{ color: def.color, flexShrink: 0, fontWeight: 500 }}
          aria-label={`rated ${def.label}`}
        >
          {def.icon} {def.label}
        </span>
        <span
          className="ts-13 flex-1"
          style={{ color: 'var(--text)', minWidth: 0 }}
        >
          {savedReasoning}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ts-12 mono hover:underline flex-shrink-0"
          style={{
            color: 'var(--mute)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          edit
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="ts-12 mono uppercase mr-1"
          style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
        >
          your call
        </span>
        {RATING_DEFS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => submit(r.value)}
            disabled={pending}
            className="ts-12 mono"
            style={{
              border: `1px solid ${
                rating === r.value ? r.color : 'var(--line)'
              }`,
              background:
                rating === r.value
                  ? `color-mix(in oklab, ${r.color} 12%, transparent)`
                  : 'var(--panel)',
              color: rating === r.value ? r.color : 'var(--text)',
              borderRadius: 6,
              padding: '4px 10px',
              cursor: pending ? 'wait' : 'pointer',
              opacity: pending ? 0.5 : 1,
              fontWeight: rating === r.value ? 600 : 500,
            }}
          >
            {r.icon} {r.label}
          </button>
        ))}
        {existing && (
          <button
            type="button"
            onClick={() => {
              setEditing(false)
              setError(null)
            }}
            className="ts-12 mono ml-auto hover:underline"
            style={{
              color: 'var(--mute)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            cancel
          </button>
        )}
      </div>
      <textarea
        ref={reasoningRef}
        defaultValue={savedReasoning}
        placeholder="One-line reason (required) — e.g. 'should have called search_db first'"
        rows={2}
        className="ts-13 mono"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: '6px 9px',
          color: 'var(--hi)',
          width: '100%',
          resize: 'vertical',
          fontSize: 12.5,
          lineHeight: 1.45,
        }}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter → save with the LAST clicked or existing rating.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            if (rating != null) submit(rating)
          }
        }}
      />
      {error && (
        <div
          className="ts-12 mono"
          style={{ color: 'var(--danger)' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {!error && (
        <div className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
          click a rating to save · ⌘/Ctrl+Enter to resubmit current rating
        </div>
      )}
    </div>
  )
}
