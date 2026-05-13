'use client'

import { useEffect } from 'react'
import type { Mark, RubricSpec } from '@/lib/templates/rubric'
import { rubricsForStepKind } from '@/lib/templates/rubric'
import type { StepView, AnnotateMode } from './types'

export interface KeyboardHandlerArgs {
  mode: AnnotateMode
  setMode: (m: AnnotateMode) => void
  deepDive: boolean
  setDeepDive: (v: boolean) => void
  steps: readonly StepView[]
  selectedIdx: number
  setSelectedIdx: (idx: number | ((prev: number) => number)) => void
  rubric: RubricSpec
  myMarks: Readonly<Record<string, Readonly<Record<string, Mark>>>>
  /** Called to commit a single rubric value on the selected step. */
  onRateStep: (
    stepId: string,
    rubricId: string,
    patch: Partial<Mark>,
  ) => void
  /** Called when the user opens / closes the rubric reference drawer. */
  setShowReference: (v: boolean) => void
}

/**
 * Global keyboard handler for the annotation surface.
 *
 * Behavior matches the design:
 *   j / k                — prev / next step (skipped when a text input has focus)
 *   1 / 3 / 5            — set primary likert on selected step
 *   b                    — toggle bool (safety) on selected step
 *   ?                    — open rubric reference drawer
 *   Esc                  — close reference drawer
 *   ⌘D / Ctrl+D          — toggle Deep Dive
 *   ⌘\ / Ctrl+\          — switch to Compare mode (toggle)
 *   ⌘F / Ctrl+F          — switch to Focus mode (toggle)
 *
 * Focus-mode behavior: after a 1/3/5 rating lands, advance to the next step
 * 160ms later. Slightly slower than the design (which used the same delay)
 * so the user sees the rating "click" before disappearing — this matters in
 * the BIG likert layout where the animation is more visible.
 *
 * Why a hook, not inline: this is the third place we'd write this logic if
 * we inlined it (one per layout). Extracting it keeps the layouts focused
 * on rendering and lets us unit-test the key map separately if needed.
 */

const ADVANCE_DELAY_MS = 160

export function useAnnotateKeyboard(args: KeyboardHandlerArgs): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const editable =
        target &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.isContentEditable)

      // Cmd/Ctrl shortcuts run regardless of focus
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'd' || e.key === 'D') {
          e.preventDefault()
          args.setDeepDive(!args.deepDive)
          return
        }
        if (e.key === '\\') {
          e.preventDefault()
          args.setMode(args.mode === 'compare' ? 'standard' : 'compare')
          return
        }
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault()
          args.setMode(args.mode === 'focus' ? 'standard' : 'focus')
          return
        }
        return
      }

      // Everything else gets blocked while typing in a text field
      if (editable) return

      if (e.key === '?') {
        args.setShowReference(true)
        return
      }
      if (e.key === 'Escape') {
        args.setShowReference(false)
        return
      }
      if (e.key === 'j') {
        args.setSelectedIdx((i: number) =>
          Math.min(args.steps.length - 1, i + 1),
        )
        return
      }
      if (e.key === 'k') {
        args.setSelectedIdx((i: number) => Math.max(0, i - 1))
        return
      }

      if (e.key === '1' || e.key === '3' || e.key === '5') {
        const v = (Number(e.key) as 1 | 3 | 5)
        const step = args.steps[args.selectedIdx]
        if (!step) return
        const applicable = rubricsForStepKind(args.rubric, step.kind)
        const primary = applicable.find((r) => r.scale === 'likert')
        if (!primary) return
        args.onRateStep(step.id, primary.id, { scale: 'likert', value: v })
        if (args.mode === 'focus') {
          window.setTimeout(() => {
            args.setSelectedIdx((i: number) =>
              Math.min(args.steps.length - 1, i + 1),
            )
          }, ADVANCE_DELAY_MS)
        }
        return
      }

      if (e.key === 'b') {
        const step = args.steps[args.selectedIdx]
        if (!step) return
        const applicable = rubricsForStepKind(args.rubric, step.kind)
        const primary = applicable.find((r) => r.scale === 'bool')
        if (!primary) return
        const cur = args.myMarks[step.id]?.[primary.id]
        const next =
          cur && cur.scale === 'bool' ? !cur.value : true
        args.onRateStep(step.id, primary.id, { scale: 'bool', value: next })
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    args.mode,
    args.deepDive,
    args.selectedIdx,
    args.steps,
    args.rubric,
    args.myMarks,
    args.setMode,
    args.setDeepDive,
    args.setSelectedIdx,
    args.onRateStep,
    args.setShowReference,
  ])
}
