'use client'

import './annotate.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type WritableAtom,
  useAtom,
  useStore,
  Provider as JotaiProvider,
} from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import type { Mark, RubricSpec } from '@/lib/templates/rubric'
import { rubricsForStepKind } from '@/lib/templates/rubric'
import type {
  ClaudeHintsByStep,
  PeerMarksByStep,
  StepMarksByStep,
  TrajectoryMarks,
  TrajectoryView,
} from './types'
import { TopBar, type AnnotateProgress } from './top-bar'
import { BottomBar } from './bottom-bar'
import { HeatMapStrip } from './heat-map-strip'
import { StandardLayout } from './layouts/standard'
import { FocusLayout } from './layouts/focus'
import { CompareLayout } from './layouts/compare'
import { AttachmentsStrip } from './attachments-strip'
import { RubricReferenceDrawer } from './rubric-reference-drawer'
import { useAnnotateKeyboard } from './use-annotate-keyboard'
import { useAutosaveMark } from './use-autosave-mark'
import {
  deepDiveAtom,
  modeAtom,
  selectedIdxAtom,
  showReferenceAtom,
  stepMarkAtomFamily,
  stepMarkKey,
  trajectoryMarkAtomFamily,
} from './store'

/**
 * <TrajectoryAnnotator /> — Step 3 atomic-state edition.
 *
 * State changes from Step 2:
 *   - Mark values live in Jotai `atomFamily` keyed by (stepId, rubricId)
 *     and rubricId. Each rubric input subscribes to ONE atom — toggling a
 *     Likert doesn't re-render the panel, let alone the trajectory.
 *   - UI state (mode, selected step, deep-dive, reference drawer) lives in
 *     Jotai too so deep children (e.g. keyboard hook) can read it without
 *     prop drilling.
 *   - Autosave: every mark change calls `commitStepMark` / `commitTrajectoryMark`
 *     debounced 500ms per key. Optimistic UI — atom updates immediately, server
 *     write happens in the background, per-key status atoms drive a tiny
 *     spinner/✓/✕ in the row.
 *
 * What the shell still does in plain useState:
 *   - `marksSnapshot` — a denormalized read-through of the atomFamily used by
 *     the heat-map strip + step-list completion dots. Subscribing to all
 *     N×R atoms from the strip would be N×R hooks; instead, the autosave hook
 *     bumps a counter and we recompute the snapshot via useStore.peek() on
 *     each mutation.
 */

export interface TrajectoryAnnotatorProps {
  workspaceId: string
  trajectory: TrajectoryView
  rubric: RubricSpec
  initialStepMarks: StepMarksByStep
  initialTrajectoryMarks: TrajectoryMarks
  peerMarksByStep: PeerMarksByStep
  claudeHintsByStep: ClaudeHintsByStep
  /** Other trajectories in the workspace, for the Compare-mode picker. */
  candidateTrajectories?: Array<{
    id: string
    agentName: string
    capturedAt: Date | null
    stepCount: number
  }>
  /** Optional trajectory to compare against (B side). Driven by ?compareWith URL param. */
  compareWithTrajectory?: TrajectoryView | null
  disabled?: boolean
  onSubmit?: () => void
  submitDisabled?: boolean
  submitLabel?: string
}

/**
 * The exported component wraps the actual annotator in its own Jotai
 * `<Provider>` so atoms have an isolated scope (navigation away destroys
 * them) — and immediately hydrates the families from SSR data so the very
 * first paint reflects existing marks. Without this hydration, the page
 * would briefly render empty inputs before the useEffect-based atom write
 * lands; with it, SSR HTML and post-mount HTML agree.
 */
export function TrajectoryAnnotator(props: TrajectoryAnnotatorProps) {
  return (
    <JotaiProvider>
      <HydrateMarkAtoms
        initialStepMarks={props.initialStepMarks}
        initialTrajectoryMarks={props.initialTrajectoryMarks}
      />
      <TrajectoryAnnotatorInner {...props} />
    </JotaiProvider>
  )
}

/**
 * Hydration child. `useHydrateAtoms` is a no-op on subsequent renders, so
 * the same instance is safe to mount once and forget — only the FIRST render
 * pumps values into atoms. Navigating to a different trajectory unmounts
 * the parent Provider, gets a fresh hydrator on the new mount.
 *
 * The hydrate list is computed once (per mount) and uses `atomFamily(...)`
 * lookups to materialize the family-member atoms before the children read
 * them.
 */
function HydrateMarkAtoms({
  initialStepMarks,
  initialTrajectoryMarks,
}: {
  initialStepMarks: StepMarksByStep
  initialTrajectoryMarks: TrajectoryMarks
}) {
  // useHydrateAtoms expects [WritableAtom, value][]. Our family atoms are
  // exactly that under the hood — atomFamily returns a writable primitive
  // atom — but the inferred type is the broader `Atom<>`, so we cast at the
  // tuple boundary. Safe: we own both the atom and the value here.
  type WritableTuple = readonly [WritableAtom<unknown, [unknown], unknown>, unknown]
  const initialValues = useMemo<WritableTuple[]>(() => {
    const out: WritableTuple[] = []
    for (const [stepId, bucket] of Object.entries(initialStepMarks)) {
      for (const [rubricId, mark] of Object.entries(bucket)) {
        out.push([
          stepMarkAtomFamily(
            stepMarkKey(stepId, rubricId),
          ) as unknown as WritableAtom<unknown, [unknown], unknown>,
          mark,
        ])
      }
    }
    for (const [rubricId, mark] of Object.entries(initialTrajectoryMarks)) {
      out.push([
        trajectoryMarkAtomFamily(rubricId) as unknown as WritableAtom<
          unknown,
          [unknown],
          unknown
        >,
        mark,
      ])
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useHydrateAtoms(initialValues)
  return null
}

function TrajectoryAnnotatorInner({
  workspaceId,
  trajectory,
  rubric,
  peerMarksByStep,
  claudeHintsByStep,
  candidateTrajectories,
  compareWithTrajectory,
  disabled,
  onSubmit,
  submitDisabled,
  submitLabel,
}: TrajectoryAnnotatorProps) {
  const store = useStore()
  const [mode, setMode] = useAtom(modeAtom)
  const [deepDive, setDeepDive] = useAtom(deepDiveAtom)
  const [selectedIdx, setSelectedIdx] = useAtom(selectedIdxAtom)
  const [showReference, setShowReference] = useAtom(showReferenceAtom)

  // Marks snapshot — read-through of the atomFamily for summary surfaces
  // (heat-map strip + step-list completion dots). We bump a counter on
  // every save; a useMemo recomputes the map by reading from the families.
  //
  // Why a snapshot instead of subscribing to all atoms in the strip: we'd
  // need N × R `useAtomValue` hooks (impossible in a loop), or one big
  // derived atom over the whole family (heavy on every keystroke). One
  // recompute per save is the sweet spot.
  //
  // The initial tick is `1` so the snapshot computes once on mount — the
  // hydration of atoms via `<HydrateMarkAtoms>` happens before this
  // component's first render, so the read picks up SSR values immediately.
  const [tick, setTick] = useState(1)

  // Reset selected index when navigating to a new trajectory. The Provider
  // unmounts on route change so atoms reset automatically; the
  // selectedIdxAtom lives outside the families so we reset it explicitly.
  useEffect(() => {
    setSelectedIdx(0)
    setTick((t) => t + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trajectory.id])

  // ─── Autosave wiring ──────────────────────────────────────────────────
  const { saveStepMark, saveTrajectoryMark } = useAutosaveMark({
    workspaceId,
    trajectoryId: trajectory.id,
  })

  // The callbacks panels invoke. They:
  //   1. Read current atom value, merge the patch
  //   2. Hand the merged Mark to autosave (which writes atom + queues server)
  //   3. Bump tick so the snapshot recomputes
  const onChangeStepMark = useCallback(
    (stepId: string, rubricId: string, patch: Partial<Mark>) => {
      const cur = store.get(stepMarkAtomFamily(stepMarkKey(stepId, rubricId)))
      const next = mergeMark(cur, patch)
      if (!next) return
      // Force-flush text marks immediately — `onBlur` already delayed enough.
      saveStepMark(stepId, rubricId, next, {
        flushNow: next.scale === 'text',
      })
      setTick((t) => t + 1)
    },
    [saveStepMark, store],
  )

  const onChangeTrajectoryMark = useCallback(
    (rubricId: string, patch: Partial<Mark>) => {
      const cur = store.get(trajectoryMarkAtomFamily(rubricId))
      const next = mergeMark(cur, patch)
      if (!next) return
      saveTrajectoryMark(rubricId, next, {
        flushNow: next.scale === 'text',
      })
      setTick((t) => t + 1)
    },
    [saveTrajectoryMark, store],
  )

  // ─── Snapshot derived from atoms (one recompute per `tick`) ───────────
  const marksSnapshot = useMemo<StepMarksByStep>(() => {
    const out: Record<string, Record<string, Mark>> = {}
    for (const s of trajectory.steps) {
      const applicable = rubricsForStepKind(rubric, s.kind)
      const stepBucket: Record<string, Mark> = {}
      for (const item of applicable) {
        const m = store.get(
          stepMarkAtomFamily(stepMarkKey(s.id, item.id)),
        )
        if (m) stepBucket[item.id] = m
      }
      if (Object.keys(stepBucket).length) out[s.id] = stepBucket
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, trajectory.steps, rubric])

  const progress = useMemo<AnnotateProgress>(
    () => computeProgress(trajectory, rubric, marksSnapshot),
    [trajectory, rubric, marksSnapshot],
  )

  // Keyboard handler — reads marksSnapshot for the bool toggle inversion.
  useAnnotateKeyboard({
    mode,
    setMode,
    deepDive,
    setDeepDive,
    steps: trajectory.steps,
    selectedIdx,
    setSelectedIdx,
    rubric,
    myMarks: marksSnapshot,
    onRateStep: onChangeStepMark,
    setShowReference,
  })

  return (
    <div
      className="app-light"
      style={{
        display: 'grid',
        gridTemplateRows: 'auto auto 1fr auto',
        height: '100vh',
        minHeight: 0,
      }}
    >
      <TopBar
        agentName={trajectory.agentName}
        trajectoryId={trajectory.id}
        mode={mode}
        setMode={setMode}
        deepDive={deepDive}
        setDeepDive={setDeepDive}
        progress={progress}
        onOpenReference={() => setShowReference(true)}
        onSubmit={onSubmit}
        submitDisabled={submitDisabled}
        submitLabel={submitLabel}
      />

      {trajectory.attachments.length > 0 && (
        <AttachmentsStrip attachments={trajectory.attachments} />
      )}

      <div className="px-5 py-2 hairline-b" style={{ background: 'var(--bg)' }}>
        <HeatMapStrip
          rubric={rubric}
          steps={trajectory.steps}
          myMarks={marksSnapshot}
          peerMarksByStep={peerMarksByStep}
          selectedIdx={selectedIdx}
          onJump={setSelectedIdx}
        />
      </div>

      {mode === 'standard' && (
        <StandardLayout
          trajectory={trajectory}
          rubric={rubric}
          selectedIdx={selectedIdx}
          setSelectedIdx={setSelectedIdx}
          marksSnapshot={marksSnapshot}
          onChangeStepMark={onChangeStepMark}
          onChangeTrajectoryMark={onChangeTrajectoryMark}
          peerMarksByStep={peerMarksByStep}
          claudeHintsByStep={claudeHintsByStep}
          deepDive={deepDive}
          disabled={disabled}
        />
      )}
      {mode === 'focus' && (
        <FocusLayout
          trajectory={trajectory}
          rubric={rubric}
          selectedIdx={selectedIdx}
          setSelectedIdx={setSelectedIdx}
          onChangeStepMark={onChangeStepMark}
          disabled={disabled}
        />
      )}
      {mode === 'compare' && (
        <CompareLayout
          trajectory={trajectory}
          rubric={rubric}
          candidateTrajectories={candidateTrajectories ?? []}
          compareWith={compareWithTrajectory ?? null}
          workspaceId={workspaceId}
        />
      )}

      <BottomBar mode={mode} />

      {showReference && (
        <RubricReferenceDrawer onClose={() => setShowReference(false)} />
      )}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Merge a patch onto the current mark.
 *
 * If the current mark is absent, the patch must include `scale` + `value`
 * (the caller does so when creating). Same-scale patches merge fields;
 * scale changes replace wholesale.
 *
 * Returns null when the patch can't form a valid Mark (e.g. reason-only
 * patch with no existing mark) so callers can ignore no-op edits.
 */
function mergeMark(
  cur: Mark | undefined,
  patch: Partial<Mark>,
): Mark | null {
  if (!cur) {
    if (!('scale' in patch) || !('value' in patch)) return null
    return patch as Mark
  }
  if (!('scale' in patch) || patch.scale === cur.scale) {
    return { ...cur, ...patch } as Mark
  }
  // Scale change: requires a value too.
  if (!('value' in patch)) return null
  return patch as Mark
}

function computeProgress(
  trajectory: TrajectoryView,
  rubric: RubricSpec,
  marks: Readonly<Record<string, Readonly<Record<string, Mark>>>>,
): AnnotateProgress {
  let rated = 0
  let markCount = 0
  let totalMarks = 0
  for (const s of trajectory.steps) {
    const applicable = rubricsForStepKind(rubric, s.kind)
    totalMarks += applicable.length
    const sm = marks[s.id] ?? {}
    let hasAny = false
    for (const item of applicable) {
      const m = sm[item.id]
      if (m && (m.scale === 'text' ? m.value.trim() : m.value != null)) {
        markCount++
        hasAny = true
      }
    }
    if (hasAny) rated++
  }
  return {
    rated,
    total: trajectory.steps.length,
    marks: markCount,
    totalMarks,
  }
}
