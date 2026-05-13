'use client'

import type { Mark, RubricSpec } from '@/lib/templates/rubric'
import type {
  TrajectoryView,
  ClaudeHintsByStep,
  PeerMarksByStep,
  StepMarksByStep,
} from '../types'
import { StepList } from '../step-list'
import { StepDetail } from '../step-detail'
import { StepRubricPanel } from '../step-rubric-panel'
import { TrajectoryRubricPanel } from '../trajectory-rubric-panel'

/**
 * Three-pane layout: step list / step detail / rubric panels.
 *
 *   ┌──────────┬──────────────────┬──────────────────┐
 *   │ StepList │ StepDetail       │ StepRubricPanel  │
 *   │          │ (center, large)  │ ──────────────── │
 *   │          │                  │ TrajectoryRubric │
 *   └──────────┴──────────────────┴──────────────────┘
 *
 * Mark state lives in Jotai atoms; this layout receives the dispatcher
 * callbacks and lets the atomic rubric rows read their own atom directly.
 */

export interface StandardLayoutProps {
  trajectory: TrajectoryView
  rubric: RubricSpec
  selectedIdx: number
  setSelectedIdx: (idx: number) => void
  /** Read-only snapshot for the StepList completion dots. Updated by autosave. */
  marksSnapshot: StepMarksByStep
  onChangeStepMark: (stepId: string, rubricId: string, patch: Partial<Mark>) => void
  onChangeTrajectoryMark: (rubricId: string, patch: Partial<Mark>) => void
  peerMarksByStep: PeerMarksByStep
  claudeHintsByStep: ClaudeHintsByStep
  deepDive: boolean
  disabled?: boolean
}

export function StandardLayout({
  trajectory,
  rubric,
  selectedIdx,
  setSelectedIdx,
  marksSnapshot,
  onChangeStepMark,
  onChangeTrajectoryMark,
  peerMarksByStep,
  claudeHintsByStep,
  deepDive,
  disabled,
}: StandardLayoutProps) {
  const step = trajectory.steps[selectedIdx]

  return (
    <div
      className="grid flex-1 min-h-0"
      style={{
        gridTemplateColumns: '280px minmax(0, 1fr) 380px',
      }}
    >
      <aside
        className="flex flex-col min-h-0 hairline-r"
        style={{ background: 'var(--panel)' }}
      >
        <div className="px-4 py-3 hairline-b">
          <div className="lbl mb-0.5">steps</div>
          <div
            className="mono ts-11"
            style={{ color: 'var(--mute2)' }}
          >
            {trajectory.steps.length} total
          </div>
        </div>
        <StepList
          rubric={rubric}
          steps={trajectory.steps}
          myMarks={marksSnapshot}
          selectedIdx={selectedIdx}
          onSelect={setSelectedIdx}
        />
      </aside>

      <section
        className="scroll min-h-0"
        style={{ background: 'var(--bg)' }}
      >
        {step ? (
          <StepDetail step={step} />
        ) : (
          <div className="px-6 py-10 ts-13" style={{ color: 'var(--mute)' }}>
            No step selected.
          </div>
        )}
      </section>

      <aside
        className="scroll min-h-0 hairline-l"
        style={{ background: 'var(--panel)' }}
      >
        {step && (
          <StepRubricPanel
            rubric={rubric}
            step={step}
            onChangeMark={onChangeStepMark}
            peerMarksByStep={peerMarksByStep}
            claudeHintsByStep={claudeHintsByStep}
            deepDive={deepDive}
            disabled={disabled}
          />
        )}
        <TrajectoryRubricPanel
          rubric={rubric}
          onChangeMark={onChangeTrajectoryMark}
          deepDive={deepDive}
          disabled={disabled}
        />
      </aside>
    </div>
  )
}
