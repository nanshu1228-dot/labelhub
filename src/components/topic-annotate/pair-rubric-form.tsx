'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitAnnotation } from '@/lib/actions/annotations'
import type { PairChecklistItem } from '@/lib/templates/types'
import { TopicHeader } from './topic-header'
import { AIPrecheckButton } from './ai-precheck'
import {
  autosaveStatusLabel,
  useAutosaveDraft,
  type AutosaveStatus,
} from './use-autosave-draft'

/**
 * Pair-Rubric annotator.
 *
 * For each rubric item in the template's pairChecklist, the annotator
 * picks yes/no for BOTH model A and model B. Each rubric line yields two
 * booleans — that's the core comparison signal (which model satisfies
 * which constraint).
 *
 * State shape:
 *   ratings: { [rubricId]: { a: boolean | null, b: boolean | null } }
 *
 * `null` (in client state) means "annotator hasn't decided yet" — we
 * skip null entries when saving so the payload stays compact and so a
 * half-finished draft doesn't ship spurious false's.
 */

type Verdict = boolean | null

type RatingsState = Record<string, { a: Verdict; b: Verdict }>

/**
 * Per-topic custom rubric items the annotator added. Each is rendered
 * after the preset rows with a small "custom" tag + delete button.
 * Stored alongside `ratings` so re-renders can label them.
 */
interface CustomItem {
  id: string
  name: string
  description?: string
}

function initialRatings(
  checklist: readonly PairChecklistItem[],
  customItems: readonly CustomItem[],
  payload: Record<string, unknown>,
): RatingsState {
  const ratings = (payload.ratings ?? {}) as Record<
    string,
    { a?: boolean; b?: boolean }
  >
  const out: RatingsState = {}
  for (const item of [...checklist, ...customItems]) {
    const prior = ratings[item.id] ?? {}
    out[item.id] = {
      a: typeof prior.a === 'boolean' ? prior.a : null,
      b: typeof prior.b === 'boolean' ? prior.b : null,
    }
  }
  return out
}

function initialCustomItems(payload: Record<string, unknown>): CustomItem[] {
  const raw = payload.customItems
  if (!Array.isArray(raw)) return []
  const out: CustomItem[] = []
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const item = v as Record<string, unknown>
    if (
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      !item.id ||
      !item.name
    )
      continue
    out.push({
      id: item.id,
      name: item.name,
      description:
        typeof item.description === 'string' ? item.description : undefined,
    })
  }
  return out
}

function ratingsToPayload(state: RatingsState) {
  const out: Record<string, { a: boolean; b: boolean }> = {}
  for (const [id, val] of Object.entries(state)) {
    if (typeof val.a === 'boolean' && typeof val.b === 'boolean') {
      out[id] = { a: val.a, b: val.b }
    }
  }
  return out
}

function countComplete(state: RatingsState): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const val of Object.values(state)) {
    total += 1
    if (typeof val.a === 'boolean' && typeof val.b === 'boolean') done += 1
  }
  return { done, total }
}

/**
 * Decide whether a conditional item should be visible given the parent's
 * current answer. For pair-rubric: parent.a or parent.b must equal
 * showWhen.when on at least one side. (We surface the item the moment
 * EITHER side matches; the annotator can still choose to leave the
 * unmatched side blank.)
 *
 * Items without a showWhen are always visible (true).
 */
function isItemVisible(
  item: PairChecklistItem,
  state: RatingsState,
): boolean {
  if (!item.showWhen) return true
  if (typeof item.showWhen.when !== 'boolean') return false
  const parent = state[item.showWhen.parentId]
  if (!parent) return false
  return parent.a === item.showWhen.when || parent.b === item.showWhen.when
}

/**
 * Same as countComplete but only counts items currently visible. Hidden
 * conditional items are excluded so the "fully filled" gate doesn't ask
 * for answers that aren't shown.
 */
function countCompleteVisible(
  checklist: readonly PairChecklistItem[],
  customItems: readonly CustomItem[],
  state: RatingsState,
): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const item of [...checklist, ...customItems]) {
    if (!isItemVisible(item, state)) continue
    total += 1
    const val = state[item.id]
    if (typeof val?.a === 'boolean' && typeof val?.b === 'boolean') done += 1
  }
  return { done, total }
}

/**
 * Generate a stable-ish id for a new custom item. Format:
 * `custom_<slug>_<short-random>` — keeps ids snake_case-ish so they
 * pass the rubric-id regex if anyone ever validates server-side, and
 * randomizes the tail so two annotators adding "Tone" don't collide
 * across raters.
 */
function newCustomId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'item'
  const rand = Math.random().toString(36).slice(2, 6)
  return `custom_${slug}_${rand}`
}

export interface PairPeerCellLite {
  majority: boolean | null
  trueVotes: number
  falseVotes: number
}

export function PairRubricForm({
  workspaceId,
  topicId,
  taskId,
  topicStatus,
  itemData,
  checklist,
  initialPayload,
  taskName,
  workspaceName,
  peerConsensus,
}: {
  workspaceId: string
  topicId: string
  taskId: string
  topicStatus: string
  itemData: Record<string, unknown>
  checklist: readonly PairChecklistItem[]
  initialPayload: Record<string, unknown>
  taskName: string
  workspaceName: string
  /**
   * Peer consensus across OTHER raters on this same topic. Only passed
   * in review mode (so the active rater isn't biased mid-draft).
   * Renders an extra PEERS column with the majority votes per row.
   */
  peerConsensus?: {
    pair: Record<string, PairPeerCellLite>
    peerCount: number
  } | null
}) {
  const router = useRouter()
  const [customItems, setCustomItems] = useState<CustomItem[]>(() =>
    initialCustomItems(initialPayload),
  )
  const [ratings, setRatings] = useState<RatingsState>(() =>
    initialRatings(checklist, customItems, initialPayload),
  )
  const [notes, setNotes] = useState<string>(() =>
    typeof initialPayload.notes === 'string' ? initialPayload.notes : '',
  )
  const [isSubmitting, startSubmit] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const isReadOnly =
    topicStatus !== 'drafting' && topicStatus !== 'revising'

  const autosave = useAutosaveDraft({
    topicId,
    taskId,
    readOnly: isReadOnly,
  })

  // On mount, check IndexedDB for a draft that's fresher than the
  // server payload (e.g. the user's last session crashed before the
  // debounced save reached the server). If so, merge it over current
  // state so the rater picks up exactly where they left off.
  useEffect(() => {
    if (isReadOnly) return
    let cancelled = false
    void (async () => {
      const local = await autosave.restoreLocal()
      if (cancelled || !local) return
      // Merge: ratings + customItems + notes from local. We don't blow
      // away preset items the template added; we just slot in the
      // local answers that map by id.
      if (typeof local.notes === 'string') setNotes(local.notes)
      const localRatings = local.ratings as
        | Record<string, { a?: boolean; b?: boolean }>
        | undefined
      if (localRatings) {
        setRatings((prev) => {
          const next = { ...prev }
          for (const [id, val] of Object.entries(localRatings)) {
            next[id] = {
              a: typeof val.a === 'boolean' ? val.a : prev[id]?.a ?? null,
              b: typeof val.b === 'boolean' ? val.b : prev[id]?.b ?? null,
            }
          }
          return next
        })
      }
      const localCustom = local.customItems
      if (Array.isArray(localCustom)) {
        const restored: CustomItem[] = []
        for (const v of localCustom) {
          if (!v || typeof v !== 'object') continue
          const it = v as Record<string, unknown>
          if (typeof it.id === 'string' && typeof it.name === 'string') {
            restored.push({
              id: it.id,
              name: it.name,
              description:
                typeof it.description === 'string' ? it.description : undefined,
            })
          }
        }
        if (restored.length > 0) setCustomItems(restored)
      }
    })()
    return () => {
      cancelled = true
    }
    // restoreLocal is stable enough — we only want this on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId, isReadOnly])

  // Count completion only for items currently visible. Conditional items
  // hidden behind an unmatched parent answer aren't required, otherwise
  // submit would be blocked on questions the annotator can't even see.
  const { done, total } = countCompleteVisible(checklist, customItems, ratings)

  function setVerdict(itemId: string, side: 'a' | 'b', value: boolean) {
    setRatings((prev) => {
      const next = {
        ...prev,
        [itemId]: { ...prev[itemId], [side]: value },
      }
      // Debounced autosave fires 1.5s after the last change. Also
      // writes IndexedDB synchronously so a tab-close before the
      // server save preserves the change.
      autosave.markDirty({
        ratings: ratingsToPayload(next),
        customItems: customItems.length > 0 ? customItems : undefined,
        notes: notes.trim() || undefined,
      })
      return next
    })
  }

  function addCustomItem(name: string, description: string) {
    const trimmedName = name.trim()
    if (!trimmedName) return
    const id = newCustomId(trimmedName)
    const nextCustom: CustomItem[] = [
      ...customItems,
      {
        id,
        name: trimmedName,
        description: description.trim() || undefined,
      },
    ]
    const nextRatings = { ...ratings, [id]: { a: null, b: null } }
    setCustomItems(nextCustom)
    setRatings(nextRatings)
    autosave.markDirty({
      ratings: ratingsToPayload(nextRatings),
      customItems: nextCustom,
      notes: notes.trim() || undefined,
    })
  }

  function removeCustomItem(id: string) {
    const nextCustom = customItems.filter((c) => c.id !== id)
    const nextRatings = { ...ratings }
    delete nextRatings[id]
    setCustomItems(nextCustom)
    setRatings(nextRatings)
    autosave.markDirty({
      ratings: ratingsToPayload(nextRatings),
      customItems: nextCustom.length > 0 ? nextCustom : undefined,
      notes: notes.trim() || undefined,
    })
  }

  function buildPayload() {
    return {
      ratings: ratingsToPayload(ratings),
      customItems: customItems.length > 0 ? customItems : undefined,
      notes: notes.trim() || undefined,
    }
  }

  async function saveDraft() {
    if (isReadOnly) return
    setError(null)
    await autosave.flush(buildPayload())
  }

  function submit() {
    if (isReadOnly) return
    if (done < total) {
      setError(`Please answer every rubric for both models (${done}/${total}).`)
      return
    }
    setError(null)
    startSubmit(async () => {
      try {
        await submitAnnotation({
          topicId,
          payload: buildPayload(),
        })
        router.push(`/my/queue`)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Submit failed.')
      }
    })
  }

  return (
    <>
      <TopicHeader
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        taskName={taskName}
        itemData={itemData}
        badge="PAIR RUBRIC"
      />

      <section className="mt-8">
        <div className="flex items-baseline justify-between mb-3">
          <div className="lbl">§ RUBRIC · YES / NO PER MODEL</div>
          <div className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
            {done}/{total} answered
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
                  RUBRIC
                </th>
                <th
                  className="px-4 py-2.5 mono ts-11"
                  style={{ color: 'oklch(0.65 0.18 200)', width: 180 }}
                >
                  MODEL A
                </th>
                <th
                  className="px-4 py-2.5 mono ts-11"
                  style={{ color: 'oklch(0.7 0.18 30)', width: 180 }}
                >
                  MODEL B
                </th>
                {peerConsensus && peerConsensus.peerCount > 0 && (
                  <th
                    className="px-4 py-2.5 mono ts-11 text-center"
                    style={{ color: 'var(--mute)', width: 160 }}
                    title={`Aggregated from ${peerConsensus.peerCount} other rater${peerConsensus.peerCount === 1 ? '' : 's'} on this topic`}
                  >
                    PEERS · {peerConsensus.peerCount}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {[
                ...checklist.map((item) => ({ ...item, kind: 'preset' as const })),
                // Custom items never carry a showWhen — annotator-added
                // rubric items are always unconditional. Stamping
                // showWhen=undefined keeps the union type uniform so
                // the isItemVisible call below typechecks.
                ...customItems.map((item) => ({
                  ...item,
                  showWhen: undefined,
                  kind: 'custom' as const,
                })),
              ]
                // Hide conditional items whose parent answer doesn't match
                // the showWhen predicate yet. Once the annotator answers
                // the parent, the row fades in below it.
                .filter((item) => isItemVisible(item, ratings))
                .map((item, idx) => (
                <tr
                  key={item.id}
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                    // Subtly tint conditional follow-ups so the relationship
                    // is visible without a separate column.
                    background: item.showWhen ? 'var(--panel2)' : undefined,
                  }}
                >
                  <td
                    className="px-4 py-3 align-top"
                    style={{
                      paddingLeft: item.showWhen ? 32 : undefined,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {item.showWhen && (
                        <span
                          className="ts-11 mono"
                          style={{ color: 'var(--accent)' }}
                          aria-hidden
                          title="Conditional follow-up — depends on the answer to a parent item"
                        >
                          ↳
                        </span>
                      )}
                      <span
                        className="ts-13"
                        style={{ color: 'var(--text)', fontWeight: 500 }}
                      >
                        {item.name}
                      </span>
                      {item.kind === 'custom' && (
                        <>
                          <span
                            className="ts-11 mono px-1.5 py-0.5 rounded"
                            style={{
                              background: 'oklch(0.7 0.14 75 / 0.15)',
                              color: 'oklch(0.7 0.14 75)',
                              border: '1px solid oklch(0.7 0.14 75 / 0.35)',
                            }}
                            title="Added by you for this topic"
                          >
                            custom
                          </span>
                          {!isReadOnly && (
                            <button
                              type="button"
                              onClick={() => removeCustomItem(item.id)}
                              className="ts-11 mono"
                              style={{
                                background: 'transparent',
                                color: 'var(--mute2)',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '2px 4px',
                              }}
                              title="Remove this item"
                            >
                              ×
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {item.description && (
                      <div
                        className="ts-12 mt-0.5"
                        style={{ color: 'var(--mute2)' }}
                      >
                        {item.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center align-middle">
                    <YesNoToggle
                      value={ratings[item.id]?.a ?? null}
                      onChange={(v) => setVerdict(item.id, 'a', v)}
                      readOnly={isReadOnly}
                      sideColor="oklch(0.65 0.18 200)"
                    />
                  </td>
                  <td className="px-4 py-3 text-center align-middle">
                    <YesNoToggle
                      value={ratings[item.id]?.b ?? null}
                      onChange={(v) => setVerdict(item.id, 'b', v)}
                      readOnly={isReadOnly}
                      sideColor="oklch(0.7 0.18 30)"
                    />
                  </td>
                  {peerConsensus && peerConsensus.peerCount > 0 && (
                    <td className="px-4 py-3 text-center align-middle">
                      <PeerPairCell
                        aCell={peerConsensus.pair[`${item.id}|a`]}
                        bCell={peerConsensus.pair[`${item.id}|b`]}
                        myA={ratings[item.id]?.a ?? null}
                        myB={ratings[item.id]?.b ?? null}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!isReadOnly && (
            <AddCustomItemRow
              onAdd={(name, desc) => addCustomItem(name, desc)}
              kind="rubric"
            />
          )}
        </div>

        <div className="mt-4">
          <label className="lbl mb-1.5 block">notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => {
              // Local state changes per keystroke (cheap, render-only)
              // but the autosave only fires when the user blurs the
              // field — the AGENTS.md hard rule: NEVER save on
              // keystroke. The debounced autosave on rubric edits is
              // separate and acceptable because rubric clicks are
              // discrete events.
              setNotes(e.target.value)
            }}
            onBlur={() => void saveDraft()}
            disabled={isReadOnly}
            rows={3}
            maxLength={2000}
            placeholder="Anything the rubric didn't cover — edge cases, disagreement signals, etc."
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

        <AIPrecheckButton
          topicId={topicId}
          buildDraft={buildPayload}
          disabled={isReadOnly}
        />

        <div className="mt-6 flex items-center gap-3 flex-wrap">
          <button
            onClick={saveDraft}
            disabled={isReadOnly || autosave.status === 'saving'}
            className="ts-13 mono"
            style={{
              background: 'transparent',
              color: 'var(--text)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '6px 14px',
              cursor: isReadOnly ? 'not-allowed' : 'pointer',
              opacity:
                isReadOnly || autosave.status === 'saving' ? 0.5 : 1,
            }}
          >
            {autosave.status === 'saving' ? 'saving…' : 'save now'}
          </button>
          <button
            onClick={submit}
            disabled={isReadOnly || isSubmitting || done < total}
            className="ts-13 mono"
            style={{
              background: 'var(--accent)',
              color: 'white',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              padding: '6px 14px',
              fontWeight: 500,
              cursor:
                isReadOnly || done < total ? 'not-allowed' : 'pointer',
              opacity:
                isReadOnly || isSubmitting || done < total ? 0.5 : 1,
            }}
          >
            {isSubmitting ? 'submitting…' : 'submit'}
          </button>
          <AutosaveBadge
            status={autosave.status}
            lastSavedAt={autosave.lastSavedAt}
            errorMessage={autosave.errorMessage}
          />
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

/**
 * Compact autosave status badge for the action row. Color-codes by
 * status so a rater can see at a glance whether their changes are
 * safe:
 *   idle    — gray, low contrast (no changes yet)
 *   dirty   — amber border (unsaved changes, debounce running)
 *   saving  — accent border (network in flight)
 *   saved   — green check (server confirmed)
 *   error   — red (with the error message; kept locally per IndexedDB)
 */
function AutosaveBadge({
  status,
  lastSavedAt,
  errorMessage,
}: {
  status: AutosaveStatus
  lastSavedAt: Date | null
  errorMessage: string | null
}) {
  const label = autosaveStatusLabel(status, lastSavedAt)
  const palette: Record<AutosaveStatus, { fg: string; bg: string }> = {
    idle: { fg: 'var(--mute2)', bg: 'transparent' },
    dirty: {
      fg: 'oklch(0.55 0.14 75)',
      bg: 'oklch(0.6 0.14 75 / 0.1)',
    },
    saving: { fg: 'var(--accent)', bg: 'var(--accent-soft)' },
    saved: {
      fg: 'oklch(0.5 0.13 150)',
      bg: 'oklch(0.5 0.13 150 / 0.1)',
    },
    error: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
  }
  const p = palette[status]
  return (
    <span
      className="ts-11 mono ml-auto px-2 py-0.5 rounded inline-flex items-center gap-1"
      style={{
        color: p.fg,
        background: p.bg,
        border: status === 'idle' ? 'none' : `1px solid ${p.fg}33`,
      }}
      title={
        status === 'error' && errorMessage
          ? `${errorMessage} — your changes are still safe in your browser; reload the page to retry.`
          : status === 'dirty'
            ? 'Unsaved changes — auto-save fires in ~1 second. Local backup is already saved in your browser.'
            : undefined
      }
    >
      {label || (status === 'idle' ? '·' : status)}
    </span>
  )
}

function YesNoToggle({
  value,
  onChange,
  readOnly,
  sideColor,
}: {
  value: boolean | null
  onChange: (v: boolean) => void
  readOnly?: boolean
  sideColor: string
}) {
  return (
    <div className="inline-flex gap-1.5">
      <button
        type="button"
        onClick={() => onChange(true)}
        disabled={readOnly}
        className="mono ts-12"
        style={{
          minWidth: 56,
          padding: '4px 12px',
          borderRadius: 5,
          fontWeight: 500,
          background:
            value === true ? sideColor : 'transparent',
          color: value === true ? 'white' : sideColor,
          border: `1px solid ${value === true ? sideColor : `${sideColor}66`}`,
          cursor: readOnly ? 'not-allowed' : 'pointer',
          opacity: readOnly ? 0.6 : 1,
        }}
      >
        yes
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        disabled={readOnly}
        className="mono ts-12"
        style={{
          minWidth: 56,
          padding: '4px 12px',
          borderRadius: 5,
          fontWeight: 500,
          background:
            value === false ? 'var(--danger)' : 'transparent',
          color:
            value === false ? 'white' : 'var(--mute)',
          border: `1px solid ${value === false ? 'var(--danger)' : 'var(--line)'}`,
          cursor: readOnly ? 'not-allowed' : 'pointer',
          opacity: readOnly ? 0.6 : 1,
        }}
      >
        no
      </button>
    </div>
  )
}

/**
 * Per-row peer-consensus chip for pair-rubric. Shows the majority of
 * each side as a compact "A:✓3/✗1  B:✗4/✓0" microstat. When the
 * submitter's value (myA/myB) disagrees with the peer majority, that
 * side renders in danger color so the reviewer can spot drift instantly.
 */
function PeerPairCell({
  aCell,
  bCell,
  myA,
  myB,
}: {
  aCell?: PairPeerCellLite
  bCell?: PairPeerCellLite
  myA: boolean | null
  myB: boolean | null
}) {
  if (!aCell && !bCell) {
    return (
      <span className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
        —
      </span>
    )
  }
  const sideStat = (cell: PairPeerCellLite | undefined, my: boolean | null, label: string) => {
    if (!cell) return null
    const drifted =
      typeof my === 'boolean' && cell.majority !== null && my !== cell.majority
    const color = drifted ? 'var(--danger)' : 'var(--mute)'
    return (
      <span
        className="mono ts-11"
        style={{ color }}
        title={`${label}: ${cell.trueVotes} yes / ${cell.falseVotes} no among peers${drifted ? ' — submitter disagrees with majority' : ''}`}
      >
        {label}:{cell.trueVotes}✓/{cell.falseVotes}✗
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

/**
 * Inline "+ add custom rubric/dimension" row. Renders as a collapsed
 * "+ add" chip until clicked; expands to name + description inputs.
 * Resets after each add so the annotator can keep adding without
 * scrolling.
 */
export function AddCustomItemRow({
  onAdd,
  kind,
}: {
  onAdd: (name: string, description: string) => void
  kind: 'rubric' | 'dimension'
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  function submit() {
    if (!name.trim()) return
    onAdd(name.trim(), desc.trim())
    setName('')
    setDesc('')
    // Leave the row open so multiple adds are quick.
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mono ts-12 mt-2"
        style={{
          background: 'transparent',
          color: 'var(--accent)',
          border: '1px dashed oklch(0.6 0.18 280 / 0.4)',
          borderRadius: 5,
          padding: '6px 12px',
          cursor: 'pointer',
        }}
      >
        + add {kind} item (only for this topic)
      </button>
    )
  }

  return (
    <div
      className="rounded-md p-3 mt-2"
      style={{
        background: 'var(--bg)',
        border: '1px dashed oklch(0.6 0.18 280 / 0.4)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="lbl"
          style={{ color: 'var(--accent)' }}
        >
          + NEW {kind.toUpperCase()} (for this topic only)
        </span>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setName('')
            setDesc('')
          }}
          className="ts-11 mono ml-auto"
          style={{
            color: 'var(--mute2)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          cancel
        </button>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={
          kind === 'rubric'
            ? 'e.g. "code compiles" — short label, will be a yes/no check'
            : 'e.g. "rhyme scheme" — short label, will be scored 1–5'
        }
        maxLength={80}
        className="w-full px-3 py-1.5 ts-13 rounded-md mb-2"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          color: 'var(--text)',
          outline: 'none',
        }}
      />
      <input
        type="text"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="description (optional) — what specifically does this check mean?"
        maxLength={280}
        className="w-full px-3 py-1.5 ts-12 rounded-md mb-2"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          color: 'var(--text)',
          outline: 'none',
        }}
      />
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim()}
          className="ts-12 mono"
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: '1px solid var(--accent)',
            borderRadius: 5,
            padding: '4px 12px',
            fontWeight: 500,
            cursor: name.trim() ? 'pointer' : 'not-allowed',
            opacity: name.trim() ? 1 : 0.5,
          }}
        >
          add
        </button>
      </div>
    </div>
  )
}
