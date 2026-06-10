'use client'

import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { Mark } from '@/lib/templates/rubric'
import type {
  AnnotateMode,
  ClaudeHintsByStep,
  PeerMarksByStep,
  RubricSpec,
  TrajectoryView,
} from './types'

/**
 * Jotai store — Pillar 4's "atomic state" requirement for editable lists.
 *
 * The crucial insight: every rubric input subscribes to ONE atom keyed by
 * (stepId, rubricId). Toggling a single Likert button updates exactly that
 * atom — the other 999 rubric atoms don't see a notification, the other
 * 499 step rows don't re-render, the parent panel doesn't reconcile.
 *
 * This is the difference between O(1) and O(N) on every mark — and at
 * N=500 steps × 4 rubrics = 2000 cells, that's the line between "feels
 * native" and "30ms jank per click".
 *
 * The atomFamily caches atoms by key so calling `stepMarkAtomFamily(...)`
 * with the same key always returns the same atom instance — React treats
 * them as stable across renders, no `useMemo` needed.
 */

// ─── Selection / UI atoms ────────────────────────────────────────────────

export const selectedIdxAtom = atom(0)

export const modeAtom = atom<AnnotateMode>('standard')
export const deepDiveAtom = atom(false)
export const showReferenceAtom = atom(false)

// ─── Mark atoms ──────────────────────────────────────────────────────────

/**
 * Key for the step-mark atomFamily. We use a JSON-stable string instead of
 * the object form because atomFamily uses `Object.is` by default and the
 * caller would have to memoize the key object — JSON keys are simpler.
 */
type StepMarkKey = `${string}::${string}` // `${stepId}::${rubricId}`

const stepMarkKey = (stepId: string, rubricId: string): StepMarkKey =>
  `${stepId}::${rubricId}` as StepMarkKey

export const stepMarkAtomFamily = atomFamily(
  (_key: StepMarkKey) => atom<Mark | undefined>(undefined),
)

export const trajectoryMarkAtomFamily = atomFamily((_rubricId: string) =>
  atom<Mark | undefined>(undefined),
)

// ─── Hydration ───────────────────────────────────────────────────────────

/**
 * Pre-populate atoms with SSR data. Called once on mount with the marks
 * the server already fetched. After hydration, all writes flow through the
 * atomFamily; SSR data is the seed.
 *
 * This is a write-only atom — calling `set(hydrateMarksAtom, ...)` triggers
 * the population. Using a write atom (rather than a plain function) keeps
 * the call inside Jotai's reactivity loop so React's batching applies.
 */
export const hydrateMarksAtom = atom(
  null,
  (
    _get,
    set,
    payload: {
      stepMarks: Readonly<Record<string, Readonly<Record<string, Mark>>>>
      trajectoryMarks: Readonly<Record<string, Mark>>
    },
  ) => {
    for (const [stepId, stepBucket] of Object.entries(payload.stepMarks)) {
      for (const [rubricId, mark] of Object.entries(stepBucket)) {
        set(stepMarkAtomFamily(stepMarkKey(stepId, rubricId)), mark)
      }
    }
    for (const [rubricId, mark] of Object.entries(payload.trajectoryMarks)) {
      set(trajectoryMarkAtomFamily(rubricId), mark)
    }
  },
)

/**
 * Reset every atom in the families. Used when navigating between trajectories
 * — without this, atoms from the previous trajectory would leak into the new
 * one (atomFamily doesn't know we changed contexts).
 */
export const resetAllMarksAtom = atom(null, (_get, _set) => {
  stepMarkAtomFamily.setShouldRemove(() => true)
  stepMarkAtomFamily.setShouldRemove(null)
  trajectoryMarkAtomFamily.setShouldRemove(() => true)
  trajectoryMarkAtomFamily.setShouldRemove(null)
})

// ─── Context atoms (input data passed down from props) ───────────────────

/**
 * Static-ish context atoms — these get set once on mount and rarely change.
 * Putting them in atoms (rather than passing as props through every layout)
 * means deeply-nested children (rubric inputs, peer-mark dots) can read
 * them without prop drilling.
 *
 * NOTE: these aren't reactive in the "useful for selectors" sense — they're
 * lookup atoms. We mutate them on mount, then they're effectively immutable.
 */
export const trajectoryAtom = atom<TrajectoryView | null>(null)
export const rubricAtom = atom<RubricSpec | null>(null)
export const peerMarksByStepAtom = atom<PeerMarksByStep>({})
export const claudeHintsByStepAtom = atom<ClaudeHintsByStep>({})
export const workspaceIdAtom = atom<string | null>(null)
export const disabledAtom = atom(false)

// ─── Persistence-state atoms ─────────────────────────────────────────────

export type PersistStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error'; message: string; at: number }

/**
 * Per-key persistence status. UI surfaces this as a tiny saving/✓/✕ glyph
 * next to the input — invaluable for "did my edit land?" anxiety.
 */
export const stepPersistStatusAtomFamily = atomFamily(
  (_key: StepMarkKey) => atom<PersistStatus>({ state: 'idle' }),
)

export const trajectoryPersistStatusAtomFamily = atomFamily(
  (_rubricId: string) => atom<PersistStatus>({ state: 'idle' }),
)

// Re-export the key helper so callers don't have to know about the template
// literal type.
export { stepMarkKey }
