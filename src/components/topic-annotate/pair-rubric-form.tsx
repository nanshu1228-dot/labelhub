'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  saveDraftAnnotation,
  submitAnnotation,
} from '@/lib/actions/annotations'
import type { PairChecklistItem } from '@/lib/templates/types'
import { TopicHeader } from './topic-header'

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

function initialRatings(
  checklist: readonly PairChecklistItem[],
  payload: Record<string, unknown>,
): RatingsState {
  const ratings = (payload.ratings ?? {}) as Record<
    string,
    { a?: boolean; b?: boolean }
  >
  const out: RatingsState = {}
  for (const item of checklist) {
    const prior = ratings[item.id] ?? {}
    out[item.id] = {
      a: typeof prior.a === 'boolean' ? prior.a : null,
      b: typeof prior.b === 'boolean' ? prior.b : null,
    }
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

export function PairRubricForm({
  workspaceId,
  topicId,
  topicStatus,
  itemData,
  checklist,
  initialPayload,
  taskName,
  workspaceName,
}: {
  workspaceId: string
  topicId: string
  topicStatus: string
  itemData: Record<string, unknown>
  checklist: readonly PairChecklistItem[]
  initialPayload: Record<string, unknown>
  taskName: string
  workspaceName: string
}) {
  const router = useRouter()
  const [ratings, setRatings] = useState<RatingsState>(() =>
    initialRatings(checklist, initialPayload),
  )
  const [notes, setNotes] = useState<string>(() =>
    typeof initialPayload.notes === 'string' ? initialPayload.notes : '',
  )
  const [isSaving, startSave] = useTransition()
  const [isSubmitting, startSubmit] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const { done, total } = countComplete(ratings)
  const isReadOnly =
    topicStatus !== 'drafting' && topicStatus !== 'revising'

  function setVerdict(itemId: string, side: 'a' | 'b', value: boolean) {
    setRatings((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [side]: value },
    }))
  }

  function saveDraft() {
    if (isReadOnly) return
    setError(null)
    startSave(async () => {
      try {
        await saveDraftAnnotation({
          topicId,
          payload: {
            ratings: ratingsToPayload(ratings),
            notes: notes.trim() || undefined,
          },
        })
        setSavedAt(new Date())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed.')
      }
    })
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
          payload: {
            ratings: ratingsToPayload(ratings),
            notes: notes.trim() || undefined,
          },
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
              </tr>
            </thead>
            <tbody>
              {checklist.map((item, idx) => (
                <tr
                  key={item.id}
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                  }}
                >
                  <td className="px-4 py-3 align-top">
                    <div
                      className="ts-13"
                      style={{ color: 'var(--text)', fontWeight: 500 }}
                    >
                      {item.name}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <label className="lbl mb-1.5 block">notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveDraft}
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
