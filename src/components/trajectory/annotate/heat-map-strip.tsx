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
 * The 18px heat strip above the step list. Compact visual of "where are the
 * disputes" without scrolling the step list.
 *
 * Color logic per segment (priority order):
 *   disputed — peer raters disagree on at least one rubric (spread ≥ 2 on
 *              likert, or any non-match on bool/enum)
 *   agreed   — annotator AND at least one peer have rated, and they agree
 *   partial  — annotator rated but no peer has, OR vice versa
 *   unrated  — nobody has touched this step yet
 *
 * **Performance ceiling**: above `MAX_VISIBLE_SEGS` (200), steps are binned
 * so the DOM stays bounded. Without binning, a 1000-step trajectory would
 * render 1000 buttons (each <1px wide — unclickable AND a perf sink on
 * every re-render). The binned segment's state is the "worst" of the
 * underlying steps (disputed > agreed > partial > unrated) so trouble
 * still surfaces visually; clicking jumps to the middle of the bin.
 */

type SegState = 'unrated' | 'agreed' | 'partial' | 'disputed'

interface Segment {
  state: SegState
  /** Step index to jump to on click — the middle of the bin. */
  jumpIdx: number
  /** Number of underlying steps the bin represents (for the tooltip). */
  span: number
  /** Whether the currently-selected step falls inside this bin. */
  selected: boolean
}

const MAX_VISIBLE_SEGS = 200
const STATE_PRIORITY: Record<SegState, number> = {
  unrated: 0,
  partial: 1,
  agreed: 2,
  disputed: 3,
}

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
    () => buildSegments(rubric, steps, myMarks, peerMarksByStep, selectedIdx),
    [steps, rubric, myMarks, peerMarksByStep, selectedIdx],
  )

  const binned = steps.length > MAX_VISIBLE_SEGS

  return (
    <div className="heatmap-card" role="navigation" aria-label="Step heat map">
      <span className="lbl">
        progress
        {binned && (
          <span
            className="mono"
            style={{
              marginLeft: 6,
              color: 'var(--mute2)',
              fontSize: 10,
              fontWeight: 400,
            }}
            title={`${steps.length} steps binned into ${segs.length} segments`}
          >
            {steps.length}→{segs.length}
          </span>
        )}
      </span>
      <div className="heatmap" role="presentation">
        {segs.map((seg, i) => (
          <button
            key={i}
            type="button"
            className={`heat-seg ${seg.state} ${seg.selected ? 'now' : ''}`}
            onClick={() => onJump(seg.jumpIdx)}
            aria-label={
              seg.span === 1
                ? `Step ${seg.jumpIdx + 1} (${seg.state})`
                : `${seg.span} steps centered on ${seg.jumpIdx + 1} (${seg.state})`
            }
            title={
              seg.span === 1
                ? `${String(seg.jumpIdx + 1).padStart(2, '0')} · ${seg.state}`
                : `${seg.span} steps · ${seg.state}`
            }
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

/**
 * Compute the segment list. When step count ≤ MAX_VISIBLE_SEGS, one seg per
 * step (identical to the legacy behavior). When over, bin into equal-width
 * buckets and use the worst-priority state within each bucket so disputes
 * still surface.
 */
function buildSegments(
  rubric: RubricSpec,
  steps: readonly StepView[],
  myMarks: Readonly<Record<string, Readonly<Record<string, Mark>>>>,
  peerMarksByStep: PeerMarksByStep,
  selectedIdx: number,
): Segment[] {
  if (steps.length === 0) return []

  // Compute per-step state once.
  const states: SegState[] = new Array(steps.length)
  for (let i = 0; i < steps.length; i++) {
    states[i] = computeSegState(rubric, steps[i], myMarks, peerMarksByStep)
  }

  if (steps.length <= MAX_VISIBLE_SEGS) {
    const out: Segment[] = new Array(steps.length)
    for (let i = 0; i < steps.length; i++) {
      out[i] = {
        state: states[i],
        jumpIdx: i,
        span: 1,
        selected: i === selectedIdx,
      }
    }
    return out
  }

  const binSize = Math.ceil(steps.length / MAX_VISIBLE_SEGS)
  const out: Segment[] = []
  for (let start = 0; start < steps.length; start += binSize) {
    const end = Math.min(steps.length, start + binSize)
    let worst: SegState = 'unrated'
    let worstPrio = STATE_PRIORITY.unrated
    for (let i = start; i < end; i++) {
      const p = STATE_PRIORITY[states[i]]
      if (p > worstPrio) {
        worst = states[i]
        worstPrio = p
      }
    }
    out.push({
      state: worst,
      jumpIdx: Math.floor((start + end - 1) / 2),
      span: end - start,
      selected: selectedIdx >= start && selectedIdx < end,
    })
  }
  return out
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
    const mineHasVal =
      mine != null && (mine.scale !== 'text' ? mine.value != null : false)
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
      const allMatch = peers.every(
        (p) => valueDistance(p.value, mineVal, item.scale) === 0,
      )
      if (allMatch) anyAgreement = true
      else if (
        peers.some(
          (p) => valueDistance(p.value, mineVal, item.scale) >= 2,
        )
      ) {
        anyDispute = true
      }
    } else if (peers.length >= 2) {
      // No mine but peers agree → also a soft "agreed" signal
      const first = peers[0].value
      if (
        peers.every((p) => valueDistance(p.value, first, item.scale) === 0)
      ) {
        anyAgreement = true
      }
    }
  }

  if (anyDispute) return 'disputed'
  if (anyMineRated && anyAgreement) return 'agreed'
  if (anyMineRated || anyPeerRated) return 'partial'
  return 'unrated'
}

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
