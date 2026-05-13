'use client'

import type { Mark, RubricSpec } from '@/lib/templates/rubric'
import { rubricsForStepKind } from '@/lib/templates/rubric'
import type { ClaudeHintsByStep, PeerMarksByStep, StepView } from './types'
import { AtomicStepRubricRow } from './atomic-rubric-row'

/**
 * Right-pane container — all per-step rubrics applicable to the selected step.
 *
 * Each <AtomicStepRubricRow> subscribes to ONE atom keyed by (stepId, rubricId).
 * The panel itself only re-renders when the selected step changes; toggling a
 * Likert button doesn't propagate past the affected row.
 */

export interface StepRubricPanelProps {
  rubric: RubricSpec
  step: StepView
  /** Called whenever an individual rubric input changes. */
  onChangeMark: (stepId: string, rubricId: string, patch: Partial<Mark>) => void
  peerMarksByStep: PeerMarksByStep
  claudeHintsByStep: ClaudeHintsByStep
  deepDive?: boolean
  showKbd?: boolean
  disabled?: boolean
}

export function StepRubricPanel({
  rubric,
  step,
  onChangeMark,
  peerMarksByStep,
  claudeHintsByStep,
  deepDive,
  showKbd,
  disabled,
}: StepRubricPanelProps) {
  const applicable = rubricsForStepKind(rubric, step.kind)
  const stepPeers = peerMarksByStep[step.id] ?? {}
  const stepHints = claudeHintsByStep[step.id] ?? []

  if (applicable.length === 0) {
    return (
      <div
        className="px-5 py-6 ts-13"
        style={{ color: 'var(--mute)' }}
      >
        No rubric questions apply to a <em>{step.kind}</em> step.
      </div>
    )
  }

  return (
    <div className="px-5 py-4">
      <div className="lbl mb-1">step rubric</div>
      <h3
        className="ts-16 mb-3"
        style={{ color: 'var(--hi)', fontWeight: 500 }}
      >
        {applicable.length} question{applicable.length === 1 ? '' : 's'}
      </h3>
      <div>
        {applicable.map((item) => {
          const hint = stepHints.find((h) => h.rubricId === item.id)
          const peers = stepPeers[item.id]
          return (
            <AtomicStepRubricRow
              key={item.id}
              item={item}
              stepId={step.id}
              peerMarks={peers}
              claudeHint={hint}
              onChange={(patch) => onChangeMark(step.id, item.id, patch)}
              deepDive={deepDive}
              showKbd={showKbd}
              disabled={disabled}
            />
          )
        })}
      </div>
    </div>
  )
}
