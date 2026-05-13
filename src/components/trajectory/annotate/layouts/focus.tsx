'use client'

import { useAtomValue } from 'jotai'
import type { Mark, RubricSpec } from '@/lib/templates/rubric'
import { rubricsForStepKind } from '@/lib/templates/rubric'
import type { TrajectoryView } from '../types'
import { StepDetail } from '../step-detail'
import { stepMarkAtomFamily, stepMarkKey } from '../store'

/**
 * Focus mode — one step at a time, oversized Likert buttons, auto-advance.
 *
 *   ┌─────────────────────────────────────────┐
 *   │  StepDetail (centered, narrow column)   │
 *   │                                          │
 *   │  Big 3-button Likert (✕ / ~ / ✓)        │
 *   │                                          │
 *   │  Next step preview                       │
 *   └─────────────────────────────────────────┘
 *
 * Renders only the PRIMARY likert for the selected step's kind. Other
 * rubrics require switching back to Standard — Focus is intentionally
 * minimal so the rater can plough through a 500-step trace.
 */

export interface FocusLayoutProps {
  trajectory: TrajectoryView
  rubric: RubricSpec
  selectedIdx: number
  setSelectedIdx: (idx: number) => void
  onChangeStepMark: (stepId: string, rubricId: string, patch: Partial<Mark>) => void
  disabled?: boolean
}

const LIKERT_BIG = [
  { v: 1 as const, glyph: '✕', name: 'incorrect', kbd: '1', cls: 'l1' },
  { v: 3 as const, glyph: '~', name: 'partial', kbd: '3', cls: 'l3' },
  { v: 5 as const, glyph: '✓', name: 'correct', kbd: '5', cls: 'l5' },
]

export function FocusLayout({
  trajectory,
  rubric,
  selectedIdx,
  setSelectedIdx,
  onChangeStepMark,
  disabled,
}: FocusLayoutProps) {
  const step = trajectory.steps[selectedIdx]
  if (!step) {
    return (
      <div className="px-8 py-10 ts-13" style={{ color: 'var(--mute)' }}>
        No step selected.
      </div>
    )
  }
  const applicable = rubricsForStepKind(rubric, step.kind)
  const primary = applicable.find((r) => r.scale === 'likert')

  const nextStep = trajectory.steps[selectedIdx + 1]

  return (
    <div
      className="flex-1 min-h-0 flex flex-col items-center"
      style={{ overflow: 'auto', paddingTop: 32, paddingBottom: 64 }}
    >
      <div
        className="mono ts-11 mb-3"
        style={{ color: 'var(--mute2)' }}
      >
        step {String(selectedIdx + 1).padStart(2, '0')} of {trajectory.steps.length}
      </div>

      <div className="w-full" style={{ maxWidth: 920 }}>
        <StepDetail step={step} />
      </div>

      <div className="w-full mt-8 px-6" style={{ maxWidth: 920 }}>
        {primary ? (
          <>
            <div
              className="lbl text-center mb-2"
              style={{ color: 'var(--mute2)' }}
            >
              {primary.name}
            </div>
            <BigLikertRow
              stepId={step.id}
              rubricId={primary.id}
              disabled={disabled}
              onPick={(v) =>
                onChangeStepMark(step.id, primary.id, {
                  scale: 'likert',
                  value: v,
                })
              }
            />
          </>
        ) : (
          <div
            className="text-center ts-13"
            style={{ color: 'var(--mute)' }}
          >
            No likert rubric applies to a <em>{step.kind}</em> step.
            Use <span className="kbd">j</span> / <span className="kbd">k</span>{' '}
            to move on.
          </div>
        )}
      </div>

      {nextStep && (
        <button
          type="button"
          onClick={() => setSelectedIdx(selectedIdx + 1)}
          className="mt-6 ts-12 mono trunc-1"
          style={{
            color: 'var(--mute2)',
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            maxWidth: 920,
            textAlign: 'center',
          }}
          title="Jump to next step (j)"
        >
          next → {nextStep.kind}
        </button>
      )}
    </div>
  )
}

/**
 * The big 3-button Likert at the heart of Focus mode. Subscribes to its own
 * (stepId, rubricId) atom so only this row re-renders when the user clicks.
 */
function BigLikertRow({
  stepId,
  rubricId,
  disabled,
  onPick,
}: {
  stepId: string
  rubricId: string
  disabled?: boolean
  onPick: (v: 1 | 3 | 5) => void
}) {
  const mark = useAtomValue(stepMarkAtomFamily(stepMarkKey(stepId, rubricId)))
  const current = mark?.scale === 'likert' ? mark.value : undefined
  return (
    <div className="likert-big">
      {LIKERT_BIG.map((b) => {
        const on = current === b.v
        return (
          <button
            key={b.v}
            type="button"
            disabled={disabled}
            onClick={() => onPick(b.v)}
            className={`lkb ${on ? `on ${b.cls}` : ''}`}
          >
            <span className="g">{b.glyph}</span>
            <span className="nm">{b.name}</span>
            <span className="ks">{b.kbd}</span>
          </button>
        )
      })}
    </div>
  )
}
