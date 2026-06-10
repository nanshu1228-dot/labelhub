import { Check, X } from 'lucide-react'
import { stepperState } from '@/lib/quality/stage-labels'
import type { WorkflowStage } from '@/lib/templates/types'

/**
 * Horizontal pipeline stepper for the review detail — visualizes the
 * spec-9.3 flow 提交 → AI预审 → 初审 → 终审 → 入库 and highlights where
 * the current annotation sits. Two-stage tasks show 初审/终审; single-stage
 * collapses to one 审核 step.
 */
export function StageStepper({
  status,
  twoStage,
}: {
  status: WorkflowStage | string
  twoStage: boolean
}) {
  const { steps, activeIndex, done, rejected } = stepperState(status, twoStage)

  return (
    <div
      className="flex flex-wrap items-center gap-x-1 gap-y-2"
      aria-label="审核流程进度"
    >
      {steps.map((step, i) => {
        const isDone = done ? true : i < activeIndex
        const isActive = !done && !rejected && i === activeIndex
        const isRejectedHere = rejected && i === activeIndex

        const color = isRejectedHere
          ? 'var(--danger)'
          : isDone
            ? 'var(--success)'
            : isActive
              ? 'var(--accent)'
              : 'var(--mute2)'
        const bg = isRejectedHere
          ? 'var(--danger-soft)'
          : isDone
            ? 'var(--success-soft)'
            : isActive
              ? 'var(--accent-soft)'
              : 'var(--panel2)'
        const bord = isRejectedHere
          ? 'oklch(0.55 0.2 25 / 0.4)'
          : isDone
            ? 'oklch(0.5 0.13 150 / 0.4)'
            : isActive
              ? 'var(--accent-line)'
              : 'var(--line)'

        return (
          <div key={step} className="flex items-center">
            <span
              className="mono inline-flex items-center gap-1.5"
              style={{
                background: bg,
                color,
                border: `1px solid ${bord}`,
                borderRadius: 999,
                padding: '3px 10px',
                fontSize: 11,
                fontWeight: isActive || isRejectedHere ? 600 : 400,
                whiteSpace: 'nowrap',
              }}
            >
              {isDone ? (
                <Check size={11} />
              ) : isRejectedHere ? (
                <X size={11} />
              ) : (
                <span
                  className="inline-flex items-center justify-center"
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 999,
                    border: `1.5px solid ${color}`,
                    fontSize: 8,
                  }}
                >
                  {i + 1}
                </span>
              )}
              {step}
            </span>
            {i < steps.length - 1 ? (
              <span
                aria-hidden
                style={{
                  width: 14,
                  height: 1,
                  background: i < activeIndex || done ? 'var(--success)' : 'var(--line2)',
                  margin: '0 2px',
                }}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
