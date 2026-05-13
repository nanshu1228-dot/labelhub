'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useStore } from 'jotai'
import {
  stepMarkAtomFamily,
  trajectoryMarkAtomFamily,
  stepPersistStatusAtomFamily,
  trajectoryPersistStatusAtomFamily,
  stepMarkKey,
} from './store'
import type { Mark } from '@/lib/templates/rubric'
import {
  commitStepMark,
  commitTrajectoryMark,
} from '@/lib/actions/annotate-marks'

/**
 * Autosave coordinator.
 *
 * Returns two writers (`saveStepMark`, `saveTrajectoryMark`). Each:
 *
 *   1. Synchronously sets the atom — UI reflects the new value instantly.
 *   2. Debounces a server-action call by 500ms per (stepId, rubricId).
 *      Rapid edits collapse into a single network round-trip.
 *   3. Updates the per-key PersistStatus atom (saving / saved / error)
 *      so the row can show a tiny ✓ / ✕ / spinner.
 *
 * The debounce is per-key, not global — typing in step 5's reason field
 * doesn't delay autosave of step 3's likert. That matters when an annotator
 * is rating fast: each rubric flushes on its own clock.
 *
 * Likert/bool/enum changes use a SHORT debounce (250ms) because clicks
 * are intentional and we want them to land quickly. Text-field commits
 * are forced through `flushNow` on blur — see `onBlur` in the RubricRow.
 */

const STEP_DEBOUNCE_MS = 500
const TRAJ_DEBOUNCE_MS = 500

export interface AutosaveAPI {
  saveStepMark: (
    stepId: string,
    rubricId: string,
    mark: Mark,
    options?: { flushNow?: boolean },
  ) => void
  saveTrajectoryMark: (
    rubricId: string,
    mark: Mark,
    options?: { flushNow?: boolean },
  ) => void
}

export function useAutosaveMark(opts: {
  workspaceId: string
  trajectoryId: string
}): AutosaveAPI {
  // We need a Jotai store handle to write to ARBITRARY atoms — the per-atom
  // `useSetAtom` returns a setter bound to one atom, but we want to set a
  // different family member on each call (different stepId/rubricId).
  // `useStore()` returns the same global store provider's handle and lets
  // us do `store.set(anyAtom, value)` imperatively.
  const store = useStore()

  // Persistent timers + the latest queued mark per key. We don't keep an
  // AbortController per call: cancellation here is purely client-side timer
  // logic — once the server action fires we let it complete and resolve
  // (the optimistic UI is already correct).
  const stepTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const stepLatestRef = useRef(new Map<string, Mark>())
  const trajTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const trajLatestRef = useRef(new Map<string, Mark>())

  // Clean up timers on unmount — leaving a setTimeout pointing at a
  // component instance after unmount is the classic source of "setState on
  // unmounted component" warnings.
  useEffect(
    () => () => {
      stepTimersRef.current.forEach((t) => clearTimeout(t))
      trajTimersRef.current.forEach((t) => clearTimeout(t))
    },
    [],
  )

  const saveStepMark = useCallback<AutosaveAPI['saveStepMark']>(
    (stepId, rubricId, mark, options) => {
      const key = stepMarkKey(stepId, rubricId)
      // 1. Optimistic atom write.
      store.set(stepMarkAtomFamily(key), mark)
      // 2. Queue persistence.
      stepLatestRef.current.set(key, mark)
      const existing = stepTimersRef.current.get(key)
      if (existing) clearTimeout(existing)
      const run = () => {
        stepTimersRef.current.delete(key)
        store.set(stepPersistStatusAtomFamily(key), { state: 'saving' })
        const latest = stepLatestRef.current.get(key)
        if (!latest) return
        void commitStepMark({
          workspaceId: opts.workspaceId,
          trajectoryStepId: stepId,
          rubricId,
          mark: latest,
        })
          .then(() => {
            store.set(stepPersistStatusAtomFamily(key), {
              state: 'saved',
              at: Date.now(),
            })
          })
          .catch((err: unknown) => {
            const message =
              err instanceof Error ? err.message : 'Save failed'
            store.set(stepPersistStatusAtomFamily(key), {
              state: 'error',
              message,
              at: Date.now(),
            })
            // Keep the optimistic value in state — the user typed it, don't
            // throw away their input on a transient network error. Retry
            // by editing again or via an explicit retry button (TODO).
          })
      }
      if (options?.flushNow) run()
      else {
        const t = setTimeout(run, STEP_DEBOUNCE_MS)
        stepTimersRef.current.set(key, t)
      }
    },
    [opts.workspaceId, store],
  )

  const saveTrajectoryMark = useCallback<AutosaveAPI['saveTrajectoryMark']>(
    (rubricId, mark, options) => {
      // 1. Optimistic atom write.
      store.set(trajectoryMarkAtomFamily(rubricId), mark)
      // 2. Queue persistence.
      trajLatestRef.current.set(rubricId, mark)
      const existing = trajTimersRef.current.get(rubricId)
      if (existing) clearTimeout(existing)
      const run = () => {
        trajTimersRef.current.delete(rubricId)
        store.set(trajectoryPersistStatusAtomFamily(rubricId), {
          state: 'saving',
        })
        const latest = trajLatestRef.current.get(rubricId)
        if (!latest) return
        void commitTrajectoryMark({
          workspaceId: opts.workspaceId,
          trajectoryId: opts.trajectoryId,
          rubricId,
          mark: latest,
        })
          .then(() => {
            store.set(trajectoryPersistStatusAtomFamily(rubricId), {
              state: 'saved',
              at: Date.now(),
            })
          })
          .catch((err: unknown) => {
            const message =
              err instanceof Error ? err.message : 'Save failed'
            store.set(trajectoryPersistStatusAtomFamily(rubricId), {
              state: 'error',
              message,
              at: Date.now(),
            })
          })
      }
      if (options?.flushNow) run()
      else {
        const t = setTimeout(run, TRAJ_DEBOUNCE_MS)
        trajTimersRef.current.set(rubricId, t)
      }
    },
    [opts.workspaceId, opts.trajectoryId, store],
  )

  return { saveStepMark, saveTrajectoryMark }
}
