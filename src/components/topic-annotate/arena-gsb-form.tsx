'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  saveDraftAnnotation,
  submitAnnotation,
} from '@/lib/actions/annotations'
import type { PairChecklistItem } from '@/lib/templates/types'
import { dimensionGsb } from '@/lib/templates/modes/arena-gsb'
import { TopicHeader } from './topic-header'

/**
 * Arena-GSB annotator.
 *
 * Each admin-defined dimension gets a 1-5 score for each model. Per-dim
 * GSB (Good / Same / Bad — i.e. which model wins on that dimension) is
 * shown inline as the annotator scores; it's derived in projection, not
 * stored. The annotator then picks an explicit overall verdict (which
 * might disagree with naive sum-of-dimensions when one dimension matters
 * more), and writes a required reasoning paragraph.
 *
 * State shape (matches arena-gsb template's responseSchema):
 *   dimensions: { [id]: { a: 1..5 | null, b: 1..5 | null } }
 *   overallVerdict: 'a_better' | 'tie' | 'b_better' | null
 *   reasoning: string
 */

type DimScore = number | null
type DimensionsState = Record<string, { a: DimScore; b: DimScore }>
type Verdict = 'a_better' | 'tie' | 'b_better' | null

const SCORE_VALUES = [1, 2, 3, 4, 5] as const

/**
 * Arena-GSB uses ONLY the dimensions admins define for the task (preset
 * or templateConfig-overridden). Unlike pair-rubric, annotators do not
 * add custom dimensions here — the calibration target is to make all
 * raters score the same dimensions so cross-rater median is meaningful.
 */
function initialDimensions(
  spec: readonly PairChecklistItem[],
  payload: Record<string, unknown>,
): DimensionsState {
  const stored = (payload.dimensions ?? {}) as Record<
    string,
    { a?: number; b?: number }
  >
  const out: DimensionsState = {}
  for (const dim of spec) {
    const prior = stored[dim.id] ?? {}
    out[dim.id] = {
      a:
        typeof prior.a === 'number' && prior.a >= 1 && prior.a <= 5
          ? prior.a
          : null,
      b:
        typeof prior.b === 'number' && prior.b >= 1 && prior.b <= 5
          ? prior.b
          : null,
    }
  }
  return out
}

function dimensionsToPayload(state: DimensionsState) {
  const out: Record<string, { a: number; b: number }> = {}
  for (const [id, val] of Object.entries(state)) {
    if (typeof val.a === 'number' && typeof val.b === 'number') {
      out[id] = { a: val.a, b: val.b }
    }
  }
  return out
}

function isComplete(
  state: DimensionsState,
  verdict: Verdict,
  reasoning: string,
): { ok: true } | { ok: false; reason: string } {
  for (const [, v] of Object.entries(state)) {
    if (typeof v.a !== 'number' || typeof v.b !== 'number') {
      return { ok: false, reason: 'Score every dimension for both models.' }
    }
  }
  if (!verdict) {
    return { ok: false, reason: 'Pick an overall verdict.' }
  }
  if (!reasoning.trim()) {
    return { ok: false, reason: 'Reasoning is required.' }
  }
  return { ok: true }
}

export interface ArenaPeerCellLite {
  median: number | null
  spread: number
  raters: number
}

export function ArenaGsbForm({
  workspaceId,
  topicId,
  topicStatus,
  itemData,
  dimensions: spec,
  initialPayload,
  taskName,
  workspaceName,
  peerConsensus,
}: {
  workspaceId: string
  topicId: string
  topicStatus: string
  itemData: Record<string, unknown>
  dimensions: readonly PairChecklistItem[]
  initialPayload: Record<string, unknown>
  taskName: string
  workspaceName: string
  peerConsensus?: {
    arena: Record<string, ArenaPeerCellLite>
    peerCount: number
  } | null
}) {
  const router = useRouter()
  const [dimensions, setDimensions] = useState<DimensionsState>(() =>
    initialDimensions(spec, initialPayload),
  )
  const [verdict, setVerdict] = useState<Verdict>(() => {
    const v = initialPayload.overallVerdict
    return v === 'a_better' || v === 'tie' || v === 'b_better' ? v : null
  })
  const [reasoning, setReasoning] = useState<string>(() =>
    typeof initialPayload.reasoning === 'string'
      ? initialPayload.reasoning
      : '',
  )
  const [isSaving, startSave] = useTransition()
  const [isSubmitting, startSubmit] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const isReadOnly =
    topicStatus !== 'drafting' && topicStatus !== 'revising'

  function setScore(dimId: string, side: 'a' | 'b', value: number) {
    setDimensions((prev) => ({
      ...prev,
      [dimId]: { ...prev[dimId], [side]: value },
    }))
  }

  function payload() {
    return {
      dimensions: dimensionsToPayload(dimensions),
      overallVerdict: verdict ?? undefined,
      reasoning: reasoning.trim() || undefined,
    }
  }

  function saveDraft() {
    if (isReadOnly) return
    setError(null)
    startSave(async () => {
      try {
        await saveDraftAnnotation({ topicId, payload: payload() })
        setSavedAt(new Date())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed.')
      }
    })
  }

  function submit() {
    if (isReadOnly) return
    const check = isComplete(dimensions, verdict, reasoning)
    if (!check.ok) {
      setError(check.reason)
      return
    }
    setError(null)
    startSubmit(async () => {
      try {
        await submitAnnotation({
          topicId,
          payload: {
            dimensions: dimensionsToPayload(dimensions),
            overallVerdict: verdict!,
            reasoning: reasoning.trim(),
          },
        })
        router.push('/my/queue')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Submit failed.')
      }
    })
  }

  // Auto-suggest overall verdict from sum-of-dimensions whenever the
  // annotator hasn't explicitly picked one. We DON'T overwrite an existing
  // pick — the user's explicit verdict always wins.
  const dimSummary = (() => {
    let aWins = 0
    let bWins = 0
    let ties = 0
    for (const v of Object.values(dimensions)) {
      if (typeof v.a !== 'number' || typeof v.b !== 'number') continue
      if (v.a > v.b) aWins++
      else if (v.b > v.a) bWins++
      else ties++
    }
    return { aWins, bWins, ties }
  })()

  return (
    <>
      <TopicHeader
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        taskName={taskName}
        itemData={itemData}
        badge="ARENA GSB"
      />

      <section className="mt-8">
        <div className="flex items-baseline justify-between mb-3">
          <div className="lbl">§ DIMENSIONS · 1–5 PER MODEL</div>
          <div className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
            dim wins · A {dimSummary.aWins} / tie {dimSummary.ties} / B{' '}
            {dimSummary.bWins}
          </div>
        </div>

        <div
          className="rounded-md overflow-hidden"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          <table className="w-full ts-13">
            <thead>
              <tr
                style={{
                  background: 'var(--panel2)',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <th
                  className="text-left px-4 py-2.5 mono ts-11"
                  style={{ color: 'var(--mute)', fontWeight: 500 }}
                >
                  DIMENSION
                </th>
                <th
                  className="px-4 py-2.5 mono ts-11"
                  style={{
                    color: 'oklch(0.65 0.18 200)',
                    width: 230,
                  }}
                >
                  MODEL A
                </th>
                <th
                  className="px-4 py-2.5 mono ts-11"
                  style={{
                    color: 'oklch(0.7 0.18 30)',
                    width: 230,
                  }}
                >
                  MODEL B
                </th>
                <th
                  className="px-4 py-2.5 mono ts-11 text-center"
                  style={{ color: 'var(--mute)', width: 70 }}
                >
                  GSB
                </th>
                {peerConsensus && peerConsensus.peerCount > 0 && (
                  <th
                    className="px-4 py-2.5 mono ts-11 text-center"
                    style={{ color: 'var(--mute)', width: 170 }}
                    title={`Aggregated from ${peerConsensus.peerCount} other rater${peerConsensus.peerCount === 1 ? '' : 's'}`}
                  >
                    PEERS · {peerConsensus.peerCount}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {spec.map((dim, idx) => {
                const row = dimensions[dim.id] ?? { a: null, b: null }
                const gsb =
                  typeof row.a === 'number' && typeof row.b === 'number'
                    ? dimensionGsb(row.a, row.b)
                    : null
                return (
                  <tr
                    key={dim.id}
                    style={{
                      borderTop:
                        idx === 0 ? 'none' : '1px solid var(--line)',
                    }}
                  >
                    <td className="px-4 py-3 align-top">
                      <div
                        className="ts-13"
                        style={{
                          color: 'var(--text)',
                          fontWeight: 500,
                        }}
                      >
                        {dim.name}
                      </div>
                      {dim.description && (
                        <div
                          className="ts-12 mt-0.5"
                          style={{ color: 'var(--mute2)' }}
                        >
                          {dim.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <ScoreRow
                        value={row.a}
                        onChange={(v) => setScore(dim.id, 'a', v)}
                        readOnly={isReadOnly}
                        sideColor="oklch(0.65 0.18 200)"
                      />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <ScoreRow
                        value={row.b}
                        onChange={(v) => setScore(dim.id, 'b', v)}
                        readOnly={isReadOnly}
                        sideColor="oklch(0.7 0.18 30)"
                      />
                    </td>
                    <td className="px-4 py-3 text-center align-middle">
                      <GsbBadge gsb={gsb} />
                    </td>
                    {peerConsensus && peerConsensus.peerCount > 0 && (
                      <td className="px-4 py-3 text-center align-middle">
                        <PeerArenaCell
                          aCell={peerConsensus.arena[`${dim.id}|a`]}
                          bCell={peerConsensus.arena[`${dim.id}|b`]}
                          myA={row.a}
                          myB={row.b}
                        />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-6">
          <div className="lbl mb-1.5">§ OVERALL VERDICT</div>
          <div className="flex gap-2">
            <VerdictRadio
              label="A 优"
              value="a_better"
              current={verdict}
              onChange={setVerdict}
              readOnly={isReadOnly}
              color="oklch(0.65 0.18 200)"
            />
            <VerdictRadio
              label="平手 tie"
              value="tie"
              current={verdict}
              onChange={setVerdict}
              readOnly={isReadOnly}
              color="var(--mute)"
            />
            <VerdictRadio
              label="B 优"
              value="b_better"
              current={verdict}
              onChange={setVerdict}
              readOnly={isReadOnly}
              color="oklch(0.7 0.18 30)"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="lbl mb-1.5 block">reasoning (required)</label>
          <textarea
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            onBlur={saveDraft}
            disabled={isReadOnly}
            rows={4}
            maxLength={4000}
            placeholder="Why this verdict? Reference specific dimensions — the text is the high-value signal."
            className="w-full px-3 py-2 ts-13 rounded-md"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'var(--font-geist-sans), system-ui',
            }}
          />
        </div>

        {error && (
          <div
            className="ts-12 mono mt-3 p-2 rounded"
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid oklch(0.55 0.2 25 / 0.35)',
              color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={saveDraft}
            disabled={isReadOnly || isSaving}
            className="ts-13 mono"
            style={{
              background: 'transparent',
              color: 'var(--text)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '6px 14px',
              cursor: isReadOnly ? 'not-allowed' : 'pointer',
              opacity: isReadOnly || isSaving ? 0.5 : 1,
            }}
          >
            {isSaving ? 'saving…' : 'save draft'}
          </button>
          <button
            onClick={submit}
            disabled={isReadOnly || isSubmitting}
            className="ts-13 mono"
            style={{
              background: 'var(--accent)',
              color: 'white',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              padding: '6px 14px',
              fontWeight: 500,
              cursor: isReadOnly ? 'not-allowed' : 'pointer',
              opacity: isReadOnly || isSubmitting ? 0.5 : 1,
            }}
          >
            {isSubmitting ? 'submitting…' : 'submit'}
          </button>
          {savedAt && (
            <span
              className="ts-11 mono ml-auto"
              style={{ color: 'var(--mute2)' }}
            >
              saved {savedAt.toISOString().slice(11, 19)}
            </span>
          )}
          {isReadOnly && (
            <span
              className="ts-12 mono ml-auto px-2 py-0.5 rounded"
              style={{
                background: 'var(--panel2)',
                border: '1px solid var(--line)',
                color: 'var(--mute)',
              }}
            >
              {topicStatus.toUpperCase()} — read-only
            </span>
          )}
        </div>
      </section>
    </>
  )
}

function ScoreRow({
  value,
  onChange,
  readOnly,
  sideColor,
}: {
  value: number | null
  onChange: (v: number) => void
  readOnly?: boolean
  sideColor: string
}) {
  return (
    <div className="flex gap-1.5">
      {SCORE_VALUES.map((n) => {
        const active = value === n
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            disabled={readOnly}
            className="mono ts-12"
            style={{
              minWidth: 32,
              padding: '4px 0',
              borderRadius: 5,
              fontWeight: 600,
              background: active ? sideColor : 'transparent',
              color: active ? 'white' : sideColor,
              border: `1px solid ${active ? sideColor : `${sideColor}55`}`,
              cursor: readOnly ? 'not-allowed' : 'pointer',
              opacity: readOnly ? 0.6 : 1,
            }}
          >
            {n}
          </button>
        )
      })}
    </div>
  )
}

function GsbBadge({ gsb }: { gsb: 'A' | 'tie' | 'B' | null }) {
  if (gsb === null) {
    return (
      <span
        className="ts-11 mono"
        style={{ color: 'var(--mute2)' }}
      >
        —
      </span>
    )
  }
  const styles =
    gsb === 'A'
      ? { bg: 'oklch(0.65 0.18 200 / 0.15)', fg: 'oklch(0.65 0.18 200)' }
      : gsb === 'B'
        ? { bg: 'oklch(0.7 0.18 30 / 0.15)', fg: 'oklch(0.7 0.18 30)' }
        : { bg: 'var(--panel2)', fg: 'var(--mute)' }
  const label = gsb === 'A' ? 'A 优' : gsb === 'B' ? 'B 优' : 'tie'
  return (
    <span
      className="mono ts-11"
      style={{
        background: styles.bg,
        color: styles.fg,
        border: `1px solid ${styles.fg}33`,
        borderRadius: 4,
        padding: '2px 8px',
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  )
}

function VerdictRadio({
  label,
  value,
  current,
  onChange,
  readOnly,
  color,
}: {
  label: string
  value: Exclude<Verdict, null>
  current: Verdict
  onChange: (v: Verdict) => void
  readOnly?: boolean
  color: string
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      disabled={readOnly}
      className="ts-13 mono"
      style={{
        flex: 1,
        padding: '8px 14px',
        borderRadius: 6,
        background: active ? color : 'transparent',
        color: active ? 'white' : color,
        border: `1px solid ${active ? color : `${color}55`}`,
        fontWeight: 500,
        cursor: readOnly ? 'not-allowed' : 'pointer',
        opacity: readOnly ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  )
}

/**
 * Per-row peer-consensus chip for arena-gsb. Shows the peers' median per
 * side, e.g. "A:med 4  B:med 3". When the submitter's score diverges
 * from the peers' median by more than 1 (the IAA dispute threshold),
 * the side renders in danger color so the reviewer can spot drift.
 */
function PeerArenaCell({
  aCell,
  bCell,
  myA,
  myB,
}: {
  aCell?: ArenaPeerCellLite
  bCell?: ArenaPeerCellLite
  myA: number | null
  myB: number | null
}) {
  if (!aCell && !bCell) {
    return (
      <span className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
        —
      </span>
    )
  }
  const sideStat = (
    cell: ArenaPeerCellLite | undefined,
    my: number | null,
    label: string,
  ) => {
    if (!cell || cell.median === null) return null
    const drifted = typeof my === 'number' && Math.abs(my - cell.median) > 1
    const highSpread = cell.spread > 2
    const color = drifted
      ? 'var(--danger)'
      : highSpread
        ? 'oklch(0.7 0.14 75)'
        : 'var(--mute)'
    return (
      <span
        className="mono ts-11"
        style={{ color }}
        title={`${label}: median ${cell.median.toFixed(1)} (${cell.raters} rater${cell.raters === 1 ? '' : 's'}, spread ${cell.spread})${drifted ? ' — submitter drifts >1' : ''}`}
      >
        {label}:med {cell.median.toFixed(1)}
      </span>
    )
  }
  return (
    <div className="flex items-center justify-center gap-2">
      {sideStat(aCell, myA, 'A')}
      {sideStat(bCell, myB, 'B')}
    </div>
  )
}
