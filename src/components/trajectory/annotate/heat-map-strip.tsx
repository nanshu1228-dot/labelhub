'use client'

import { useMemo } from 'react'
import type { Mark } from '@/lib/templates/rubric'
import { rubricsForStepKind } from '@/lib/templates/rubric'
import type {
  RubricSpec,
  StepView,
  PeerMarksByStep,
} from './types'

/**
 * The 18px heat strip above the step list. One segment per step.
 *
 * Color logic per segment (priority order):
 *
 *   disputed — peer raters disagree on at least one rubric (spread ≥ 2 on
 *              likert, or any non-match on bool/enum)
 *   agreed   — annotator AND at least one peer have rated, and they agree
 *   partial  — annotator rated but no peer has, OR vice versa
 *   unrated  — nobody has touched this step yet
 *
 * The current step gets a 1.5px ring + slight Y-scale.
 *
 * Why this is a hero element: it's the only place in the UI that surfaces
 * "where are the disputes" without scrolling. For a 500-step trace, this
 * is the difference between a 90-second eyeball and a 30-minute scroll.
 */

type SegState = 'unrated' | 'agreed' | 'partial' | 'disputed'

const LEGEND: Array<{ state: SegState; label: string }> = [
  { state: 'unrated', label: 'unrated' },
  { state: 'partial', label: 'partial' },
  { state: 'agreed', label: 'agreed' },
  { state: 'disputed', label: 'dispute' },
]

export interface HeatMapStripProps {
  rubric: RubricSpec
  steps: readonly StepView[]
  myMarks: Readonly<Record<string, Readonly<Record<string, Mark>>>>
  peerMarksByStep: PeerMarksByStep
  selectedIdx: number
  onJump: (idx: number) => void
}

export function HeatMapStrip({
  rubric,
  steps,
  myMarks,
  peerMarksByStep,
  selectedIdx,
  onJump,
}: HeatMapStripProps) {
  const segs = useMemo(
    () => steps.map((s) => computeSegState(rubric, s, myMarks, peerMarksByStep)),
    [steps, rubric, myMarks, peerMarksByStep],
  )

  return (
    <div className="heatmap-card" role="navigation" aria-label="Step heat map">
      <span className="lbl">progress</span>
      <div className="heatmap" role="presentation">
        {segs.map((state, i) => (
          <button
            key={steps[i].id}
            type="button"
            className={`heat-seg ${state} ${i === selectedIdx ? 'now' : ''}`}
            onClick={() => onJump(i)}
            aria-label={`Step ${i + 1} (${state})`}
            title={`${String(i + 1).padStart(2, '0')} · ${state}`}
          />
        ))}
      </div>
      <div className="legend" aria-hidden="true">
        {LEGEND.map((l) => (
          <span key={l.state} className="legend-item">
            <span className={`leg-sw heat-seg ${l.state}`} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function computeSegState(
  rubric: RubricSpec,
  step: StepView,
  myMarks: Readonly<Record<string, Readonly<Record<string, Mark>>>>,
  peerMarksByStep: PeerMarksByStep,
): SegState {
  const applicable = rubricsForStepKind(rubric, step.kind)
  if (applicable.length === 0) return 'unrated'

  const stepMine = myMarks[step.id] ?? {}
  const stepPeers = peerMarksByStep[step.id] ?? {}

  let anyPeerRated = false
  let anyMineRated = false
  let anyDispute = false
  let anyAgreement = false

  for (const item of applicable) {
    const mine = stepMine[item.id]
    const peers = stepPeers[item.id] ?? []
    const mineHasVal = mine != null && (mine.scale !== 'text' ? mine.value != null : false)
    const peersHaveVal = peers.length > 0
    if (mineHasVal) anyMineRated = true
    if (peersHaveVal) anyPeerRated = true

    // Peer-on-peer dispute (irrespective of me)
    if (peers.length >= 2 && peerSpread(peers, item.scale) >= 2) {
      anyDispute = true
    }
    // Peer vs me dispute
    if (mineHasVal && peers.length > 0) {
      const mineVal = (mine as { value: number | string | boolean }).value
      const allMatch = peers.every((p) => valueDistance(p.value, mineVal, item.scale) === 0)
      if (allMatch) anyAgreement = true
      else if (peers.some((p) => valueDistance(p.value, mineVal, item.scale) >= 2)) {
        anyDispute = true
      }
    } else if (peers.length >= 2) {
      // No mine but peers agree → also a soft "agreed" signal
      const first = peers[0].value
      if (peers.every((p) => valueDistance(p.value, first, item.scale) === 0)) {
        anyAgreement = true
      }
    }
  }

  if (anyDispute) return 'disputed'
  if (anyMineRated && anyAgreement) return 'agreed'
  if (anyMineRated || anyPeerRated) return 'partial'
  return 'unrated'
}

/**
 * Spread between numeric ratings — 0 = identical, max for the scale otherwise.
 * For bool/enum we treat any disagreement as "max spread" (effectively a
 * binary mismatch).
 */
function peerSpread(
  peers: ReadonlyArray<{ value: number | string | boolean }>,
  scale: 'likert' | 'bool' | 'enum' | 'text',
): number {
  if (scale === 'likert') {
    const nums = peers
      .map((p) => (typeof p.value === 'number' ? p.value : NaN))
      .filter((n) => Number.isFinite(n))
    if (nums.length < 2) return 0
    return Math.max(...nums) - Math.min(...nums)
  }
  // bool/enum: 2 if not all equal, else 0
  const first = peers[0].value
  return peers.every((p) => p.value === first) ? 0 : 2
}

function valueDistance(
  a: number | string | boolean,
  b: number | string | boolean,
  scale: 'likert' | 'bool' | 'enum' | 'text',
): number {
  if (scale === 'likert' && typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b)
  }
  return a === b ? 0 : 2
}
