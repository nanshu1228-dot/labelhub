'use client'

import type { Mark, RubricSpec } from '@/lib/templates/rubric'
import { AtomicTrajectoryRubricRow } from './atomic-rubric-row'

/**
 * Right-pane container — per-trajectory rubrics (goal_achieved, path_optimality, etc.).
 *
 * Each row subscribes to its own atom keyed by rubric id, so editing one
 * trajectory-level field doesn't re-render the others.
 */

export interface TrajectoryRubricPanelProps {
  rubric: RubricSpec
  onChangeMark: (rubricId: string, patch: Partial<Mark>) => void
  deepDive?: boolean
  disabled?: boolean
}

export function TrajectoryRubricPanel({
  rubric,
  onChangeMark,
  deepDive,
  disabled,
}: TrajectoryRubricPanelProps) {
  if (!rubric.perTrajectory.length) return null
  return (
    <div className="px-5 py-4 hairline-t">
      <div className="lbl mb-1">trajectory rubric</div>
      <h3
        className="ts-16 mb-3"
        style={{ color: 'var(--hi)', fontWeight: 500 }}
      >
        Overall judgment
      </h3>
      <div>
        {rubric.perTrajectory.map((item) => (
          <AtomicTrajectoryRubricRow
            key={item.id}
            item={item}
            onChange={(patch) => onChangeMark(item.id, patch)}
            deepDive={deepDive}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  )
}
