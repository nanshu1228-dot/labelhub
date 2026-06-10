'use client'

import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Mark, RubricSpec } from '@/lib/templates/rubric'
import { rubricsForStepKind } from '@/lib/templates/rubric'
import type { StepView } from './types'
import { KindPill } from './kind-pill'

/**
 * The left-rail timeline of steps.
 *
 * Replaces the design's hand-rolled scroll-window with TanStack Virtual.
 * Why: the design works because TRAJ_A is 52 steps — manageable. Real
 * trajectories from agentic eval runs go to 500+ and the perf-test seed
 * pushes to 1000+. AGENTS.md hard rule: "Annotation grids:
 * @tanstack/react-virtual mandatory past 30 rows."
 *
 * Each row is a fixed 48px and we DO NOT set `ref={measureElement}` on
 * rows — that would attach a ResizeObserver to every visible row on
 * every scroll, which we measured as a real cost at 1000+ steps. The
 * fixed `estimateSize` is the source of truth.
 */

const ROW_HEIGHT = 48

export interface StepListProps {
  rubric: RubricSpec
  steps: readonly StepView[]
  myMarks: Readonly<Record<string, Readonly<Record<string, Mark>>>>
  selectedIdx: number
  onSelect: (idx: number) => void
}

export function StepList({
  rubric,
  steps,
  myMarks,
  selectedIdx,
  onSelect,
}: StepListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  // TanStack Virtual's useVirtualizer returns non-memoizable functions, so
  // the React Compiler skips memoizing this component (informational note).
  // Virtualization is required to render large trajectory step lists; this
  // is an accepted, library-inherent trade-off.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: steps.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  return (
    <div
      ref={parentRef}
      className="scroll"
      style={{ flex: 1, minHeight: 0 }}
      role="listbox"
      aria-label="Trajectory steps"
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          const i = vRow.index
          const step = steps[i]
          const stepMarks = myMarks[step.id] ?? {}
          const applicable = rubricsForStepKind(rubric, step.kind)
          const completionState = completionFor(applicable, stepMarks)
          return (
            <div
              key={step.id}
              role="option"
              aria-selected={i === selectedIdx}
              data-index={i}
              onClick={() => onSelect(i)}
              className={`step-row ${i === selectedIdx ? 'selected' : ''}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              <span className="idx">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <KindPill kind={step.kind} />
                </div>
                <div className="preview">{stepPreview(step)}</div>
              </div>
              <div className="row-trail">
                <span className={`completion-dot ${completionState}`} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function completionFor(
  applicable: ReadonlyArray<{ id: string }>,
  marks: Readonly<Record<string, Mark>>,
): 'none' | 'partial' | 'full' {
  if (!applicable.length) return 'none'
  let rated = 0
  for (const item of applicable) {
    const m = marks[item.id]
    if (m && (m.scale === 'text' ? m.value.trim() : m.value != null)) rated++
  }
  if (rated === 0) return 'none'
  if (rated === applicable.length) return 'full'
  return 'partial'
}

function stepPreview(step: StepView): string {
  switch (step.kind) {
    case 'tool_call':
    case 'sub_agent_call': {
      const argStr = step.args ? safeStringify(step.args) : ''
      return `${step.toolName}(${truncate(argStr, 60)})`
    }
    case 'tool_result':
      return `${step.toolName} → ${truncate(safeStringify(step.output), 80)}`
    case 'thinking':
    case 'sub_agent_response':
    case 'final_response':
    case 'error':
      return truncate(step.body, 100)
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}
