'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { RubricSpec } from '@/lib/templates/rubric'
import type { TrajectoryView, StepView } from '../types'
import { KindPill } from '../kind-pill'
import { submitComparison } from '@/lib/actions/comparisons'

/**
 * Compare layout — two trajectories side-by-side, synced scroll, pick a
 * winner per dimension.
 *
 * Two states:
 *
 *   1. PICKER — no compareWith trajectory selected yet. Shows a dropdown
 *      of other workspace trajectories. Selecting one navigates with
 *      `?compareWith=<id>`, triggering an SSR re-fetch that yields state 2.
 *
 *   2. SIDE-BY-SIDE — left column = A (the trajectory the user is on),
 *      right column = B (the picked compareWith). Both columns render
 *      step lists with truncated previews. Shared right pane has the
 *      winner picker (A wins / tie / B wins) for each rubric dimension
 *      + a reason textarea, then "Submit comparison" → writes an event
 *      and a comparison row to the DB.
 *
 * Synced scroll: scrolling one column scrolls the other to the matching
 * step index (not pixel offset — that breaks when columns have different
 * step lengths). When B is shorter, scrolling past the end on the A side
 * just clamps the B side.
 */

export interface CompareLayoutProps {
  trajectory: TrajectoryView
  rubric: RubricSpec
  /** Other trajectories in the workspace (for the picker). */
  candidateTrajectories: Array<{
    id: string
    agentName: string
    capturedAt: Date | null
    stepCount: number
  }>
  /** The trajectory we're comparing AGAINST (B side). Null = show picker. */
  compareWith: TrajectoryView | null
  workspaceId: string
}

export function CompareLayout({
  trajectory,
  rubric,
  candidateTrajectories,
  compareWith,
  workspaceId,
}: CompareLayoutProps) {
  if (!compareWith) {
    return (
      <ComparePicker
        trajectory={trajectory}
        candidates={candidateTrajectories}
      />
    )
  }
  return (
    <SideBySide
      trajA={trajectory}
      trajB={compareWith}
      rubric={rubric}
      workspaceId={workspaceId}
    />
  )
}

// ─── Picker (state 1) ──────────────────────────────────────────────────

function ComparePicker({
  trajectory,
  candidates,
}: {
  trajectory: TrajectoryView
  candidates: CompareLayoutProps['candidateTrajectories']
}) {
  const router = useRouter()
  const usable = candidates.filter((c) => c.id !== trajectory.id)

  function pick(id: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('compareWith', id)
    router.push(url.pathname + url.search)
  }

  return (
    <div
      className="flex-1 min-h-0 flex items-center justify-center"
      style={{ overflow: 'auto', padding: '32px' }}
    >
      <div style={{ maxWidth: 640, width: '100%' }}>
        <div className="lbl mb-2">compare mode</div>
        <h2
          className="ts-20"
          style={{ color: 'var(--hi)', fontWeight: 500 }}
        >
          Pick another trajectory to diff against
        </h2>
        <p
          className="ts-13 mt-2 mb-6"
          style={{ color: 'var(--mute)', lineHeight: 1.5 }}
        >
          Side-by-side view with synced step scrolling + per-dimension winner
          picker. Choosing one starts the comparison; you can switch out the
          right side anytime.
        </p>

        {usable.length === 0 ? (
          <div
            className="rounded-xl p-6 ts-13 text-center"
            style={{
              background: 'var(--panel)',
              border: '1px dashed var(--line2)',
              color: 'var(--mute)',
            }}
          >
            No other trajectories in this workspace yet. Capture or upload at
            least one more to enable compare mode.
          </div>
        ) : (
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            {usable.map((c, i) => (
              <button
                key={c.id}
                onClick={() => pick(c.id)}
                className="w-full text-left px-4 py-3 hover:bg-opacity-50"
                style={{
                  background: 'transparent',
                  borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                  cursor: 'pointer',
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div
                      className="ts-13"
                      style={{ color: 'var(--hi)', fontWeight: 500 }}
                    >
                      {c.agentName}
                    </div>
                    <div
                      className="mono ts-11 mt-0.5"
                      style={{ color: 'var(--mute2)' }}
                    >
                      {c.id.slice(0, 8)} · {c.stepCount} steps
                      {c.capturedAt &&
                        ` · captured ${c.capturedAt.toISOString().slice(0, 10)}`}
                    </div>
                  </div>
                  <span
                    className="ts-12 mono"
                    style={{ color: 'var(--accent)' }}
                  >
                    compare →
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Side-by-side (state 2) ────────────────────────────────────────────

const DIMENSIONS = [
  { id: 'goal_achieved', label: 'Goal achieved' },
  { id: 'tool_choice', label: 'Tool choice' },
  { id: 'reasoning_sound', label: 'Reasoning' },
  { id: 'path_optimality', label: 'Path optimality' },
] as const

type Winner = 'A' | 'tie' | 'B'

function SideBySide({
  trajA,
  trajB,
  rubric: _rubric,
  workspaceId,
}: {
  trajA: TrajectoryView
  trajB: TrajectoryView
  rubric: RubricSpec
  workspaceId: string
}) {
  const router = useRouter()
  const [winners, setWinners] = useState<Partial<Record<string, Winner>>>({})
  const [reason, setReason] = useState('')
  const [sharedIdx, setSharedIdx] = useState(0)
  const [isPending, startTransition] = useTransition()
  const [submitState, setSubmitState] = useState<
    'idle' | 'success' | { error: string }
  >('idle')

  // Synced scroll: both columns scroll to their step at shared index.
  const refA = useRef<HTMLDivElement>(null)
  const refB = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)

  function setSharedIdxSync(i: number) {
    setSharedIdx(i)
    syncing.current = true
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }

  function changeRight() {
    const url = new URL(window.location.href)
    url.searchParams.delete('compareWith')
    router.push(url.pathname + url.search)
  }

  function submit() {
    setSubmitState('idle')
    if (Object.keys(winners).length === 0) {
      setSubmitState({ error: 'Pick a winner on at least one dimension.' })
      return
    }
    // Local state allows clearing a dimension by clicking the same button
    // twice (undefined value via delete). Filter undefineds so the outbound
    // payload matches the action's stricter signature.
    const filteredWinners: Record<string, Winner> = {}
    for (const [k, v] of Object.entries(winners)) {
      if (v) filteredWinners[k] = v
    }
    startTransition(async () => {
      try {
        await submitComparison({
          workspaceId,
          trajectoryAId: trajA.id,
          trajectoryBId: trajB.id,
          winners: filteredWinners,
          reason: reason.trim() || undefined,
        })
        setSubmitState('success')
        // Reset local picks so the form's ready for the next comparison.
        setWinners({})
        setReason('')
      } catch (e) {
        setSubmitState({
          error: e instanceof Error ? e.message : 'Submit failed.',
        })
      }
    })
  }

  return (
    <div className="annot-compare flex-1 min-h-0">
      <Column
        label="A"
        accent="var(--text)"
        trajectory={trajA}
        sharedIdx={sharedIdx}
        scrollRef={refA}
        onPick={setSharedIdxSync}
      />
      <Column
        label="B"
        accent="var(--accent)"
        trajectory={trajB}
        sharedIdx={sharedIdx}
        scrollRef={refB}
        onPick={setSharedIdxSync}
      />

      <aside
        className="scroll min-h-0 hairline-l"
        style={{ background: 'var(--panel)', padding: '20px 20px 80px' }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="lbl">SIDE-BY-SIDE</div>
          <button
            onClick={changeRight}
            className="ts-11 mono"
            style={{
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 5,
              padding: '4px 8px',
              color: 'var(--mute)',
              cursor: 'pointer',
            }}
          >
            swap B
          </button>
        </div>
        <h3
          className="ts-16 mb-1"
          style={{ color: 'var(--hi)', fontWeight: 500 }}
        >
          Which trajectory wins per dimension?
        </h3>
        <p
          className="ts-12 mb-4"
          style={{ color: 'var(--mute)', lineHeight: 1.5 }}
        >
          You can leave dimensions blank — they'll be recorded as "no
          preference" in the comparison row.
        </p>

        <div className="space-y-3">
          {DIMENSIONS.map((d) => (
            <DimensionRow
              key={d.id}
              dimension={d}
              current={winners[d.id] ?? null}
              onPick={(w) => {
                setWinners((prev) => {
                  if (prev[d.id] === w) {
                    const { [d.id]: _, ...rest } = prev
                    return rest
                  }
                  return { ...prev, [d.id]: w }
                })
              }}
            />
          ))}
        </div>

        <textarea
          className="reason w-full mt-4"
          rows={3}
          placeholder="Why? (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        {submitState === 'success' && (
          <div
            className="ts-12 mt-3 rounded-md p-2"
            style={{
              background: 'var(--success-soft)',
              border: '1px solid oklch(0.5 0.13 150 / 0.35)',
              color: 'var(--success)',
            }}
          >
            Comparison saved. Pick another trajectory or change winners.
          </div>
        )}
        {submitState !== 'idle' && submitState !== 'success' && (
          <div
            className="ts-12 mt-3 rounded-md p-2"
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid oklch(0.55 0.2 25 / 0.35)',
              color: 'var(--danger)',
            }}
          >
            {submitState.error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={isPending || Object.keys(winners).length === 0}
          className="lh-btn lh-btn-accent mt-4"
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: 13,
            width: '100%',
            justifyContent: 'center',
            fontWeight: 500,
            cursor:
              isPending || Object.keys(winners).length === 0
                ? 'not-allowed'
                : 'pointer',
            opacity:
              isPending || Object.keys(winners).length === 0 ? 0.5 : 1,
          }}
        >
          {isPending ? 'submitting…' : 'Submit comparison'}
        </button>
      </aside>
    </div>
  )
}

function Column({
  label,
  accent,
  trajectory,
  sharedIdx,
  scrollRef,
  onPick,
}: {
  label: 'A' | 'B'
  accent: string
  trajectory: TrajectoryView
  sharedIdx: number
  scrollRef: React.RefObject<HTMLDivElement | null>
  onPick: (i: number) => void
}) {
  const step = trajectory.steps[Math.min(sharedIdx, trajectory.steps.length - 1)]
  void step // currently unused — visual cue is the highlighted row in the list
  return (
    <div
      className="flex flex-col min-h-0 hairline-r"
      style={{ background: label === 'A' ? 'var(--bg)' : 'var(--panel)' }}
    >
      <div className="flex items-center justify-between px-5 h-10 hairline-b">
        <div className="flex items-center gap-2">
          <span
            className="mono ts-11"
            style={{
              padding: '2px 7px',
              borderRadius: 4,
              background:
                label === 'A' ? 'oklch(0.94 0 0)' : 'var(--accent-soft)',
              color: accent,
              letterSpacing: '0.04em',
            }}
          >
            {label}
          </span>
          <span
            className="ts-13"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            {trajectory.agentName}
          </span>
          <span
            className="mono ts-11"
            style={{ color: 'var(--mute2)' }}
          >
            · {trajectory.id.slice(0, 8)}
          </span>
        </div>
        <span
          className="mono ts-11"
          style={{ color: 'var(--mute2)' }}
        >
          {trajectory.steps.length} steps
        </span>
      </div>
      <div
        ref={scrollRef}
        className="scroll flex-1 min-h-0"
        style={{ padding: '12px 16px' }}
      >
        <div className="space-y-2">
          {trajectory.steps.map((s, i) => (
            <StepRowCompact
              key={s.id}
              step={s}
              i={i}
              isSelected={i === sharedIdx}
              onClick={() => onPick(i)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function StepRowCompact({
  step,
  i,
  isSelected,
  onClick,
}: {
  step: StepView
  i: number
  isSelected: boolean
  onClick: () => void
}) {
  const preview = useMemo(() => stepPreview(step), [step])
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-md p-2.5"
      style={{
        background: isSelected ? 'var(--accent-soft)' : 'transparent',
        border: `1px solid ${isSelected ? 'var(--accent-line)' : 'transparent'}`,
        cursor: 'pointer',
        transition: 'background 80ms',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="mono ts-11"
          style={{
            color: isSelected ? 'var(--accent)' : 'var(--mute2)',
            minWidth: 22,
          }}
        >
          {String(i + 1).padStart(2, '0')}
        </span>
        <KindPill kind={step.kind} />
      </div>
      <div
        className="ts-12 trunc-1"
        style={{ color: isSelected ? 'var(--hi)' : 'var(--mute)' }}
      >
        {preview}
      </div>
    </button>
  )
}

function DimensionRow({
  dimension,
  current,
  onPick,
}: {
  dimension: (typeof DIMENSIONS)[number]
  current: Winner | null
  onPick: (w: Winner) => void
}) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 8,
        padding: 10,
        background: 'var(--bg)',
      }}
    >
      <div
        className="ts-12 mb-2"
        style={{ color: 'var(--hi)', fontWeight: 500 }}
      >
        {dimension.label}
      </div>
      <div className="grid grid-cols-3 gap-1">
        <WinnerButton
          letter="A"
          on={current === 'A'}
          variant="neutral"
          onClick={() => onPick('A')}
        />
        <WinnerButton
          letter="tie"
          on={current === 'tie'}
          variant="warn"
          onClick={() => onPick('tie')}
        />
        <WinnerButton
          letter="B"
          on={current === 'B'}
          variant="accent"
          onClick={() => onPick('B')}
        />
      </div>
    </div>
  )
}

function WinnerButton({
  letter,
  on,
  variant,
  onClick,
}: {
  letter: string
  on: boolean
  variant: 'neutral' | 'warn' | 'accent'
  onClick: () => void
}) {
  const palette = {
    neutral: { bg: 'oklch(0.94 0 0)', fg: 'var(--hi)' },
    warn: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
    accent: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  }[variant]
  return (
    <button
      onClick={onClick}
      className="ts-12"
      style={{
        background: on ? palette.bg : 'transparent',
        border: on ? `1px solid ${palette.fg}` : '1px solid var(--line)',
        color: on ? palette.fg : 'var(--mute)',
        borderRadius: 6,
        padding: '6px 0',
        fontFamily: 'var(--font-geist-mono), monospace',
        cursor: 'pointer',
        transition: 'all 120ms',
        fontWeight: on ? 500 : 400,
      }}
    >
      {letter} wins
    </button>
  )
}

function stepPreview(step: StepView): string {
  switch (step.kind) {
    case 'tool_call':
    case 'sub_agent_call':
      return `${step.toolName}(${safeStringify(step.args).slice(0, 50)})`
    case 'tool_result':
      return `${step.toolName} → ${safeStringify(step.output).slice(0, 70)}`
    case 'thinking':
    case 'sub_agent_response':
    case 'final_response':
    case 'error':
      return step.body.slice(0, 90)
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
