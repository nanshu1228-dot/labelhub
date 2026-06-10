'use client'

/**
 * Review queue table — Finals P3 D11.
 *
 * Shows the list of submissions awaiting review with multi-select
 * checkboxes. A floating batch-action bar appears when any item is
 * selected; the reviewer can batch-approve or batch-send-back with
 * a shared reason.
 *
 * Batch actions hit `batchReviewAnnotations` from the server-action
 * module (D11 ships the client; the action lands in
 * `src/lib/actions/review-batch.ts`). The form uses useTransition so
 * double-clicks don't double-fire.
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Flag,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react'
import {
  batchReviewAnnotations,
  type BatchDecision,
} from '@/lib/actions/review-batch'
import type { ReviewQueueItem } from '@/lib/queries/review-queue'
import { getErrorMessage } from '@/lib/errors/client-utils'
import { stageLabel } from '@/lib/quality/stage-labels'

/**
 * Canned send-back reasons. Clicking one prefills the memo so the
 * reviewer can clear routine 打回 rows fast; the text stays editable
 * (and required server-side) so they can still add specifics.
 */
const SEND_BACK_TEMPLATES = [
  'Incomplete — required fields are missing.',
  'Wrong label — the selected answer does not match the item.',
  'Guideline mismatch — does not follow the task guidelines.',
  'Low effort — please re-do this with more care.',
] as const

export function ReviewQueueTable({
  items,
}: {
  items: ReviewQueueItem[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [stageFilter, setStageFilter] = useState<'all' | 'first' | 'final'>(
    'all',
  )
  const visibleItems = useMemo(() => {
    if (stageFilter === 'final')
      return items.filter((i) => i.status === 'awaiting_acceptance')
    if (stageFilter === 'first')
      return items.filter((i) => i.status !== 'awaiting_acceptance')
    return items
  }, [items, stageFilter])
  const finalCount = useMemo(
    () => items.filter((i) => i.status === 'awaiting_acceptance').length,
    [items],
  )
  const allSelected =
    visibleItems.length > 0 && selected.size === visibleItems.length
  const [pending, startBatch] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [revisionOpen, setRevisionOpen] = useState(false)
  const [revisionFeedback, setRevisionFeedback] = useState('')
  const router = useRouter()

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(
      allSelected ? new Set() : new Set(visibleItems.map((i) => i.annotationId)),
    )
  }
  function clearSelection() {
    setSelected(new Set())
    setRevisionOpen(false)
    setRevisionFeedback('')
  }

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.annotationId)),
    [items, selected],
  )
  const selectedStageMap = useMemo<Record<string, ReviewQueueItem['status']>>(
    () =>
      Object.fromEntries(
        selectedItems.map((item) => [item.annotationId, item.status]),
      ),
    [selectedItems],
  )
  const selectedAcceptanceCount = selectedItems.filter(
    (item) => item.status === 'awaiting_acceptance',
  ).length

  async function applyBatch(decision: BatchDecision, feedback?: string) {
    setError(null)
    if (selectedItems.length === 0) return
    let reason: string | undefined
    if (decision === 'request_revision') {
      reason = feedback?.trim() ?? ''
      if (!reason.trim()) {
        setError('A reason is required when sending items back.')
        return
      }
    }
    startBatch(async () => {
      try {
        const result = await batchReviewAnnotations({
          annotationIds: selectedItems.map((i) => i.annotationId),
          decision,
          feedback: reason,
          stages: selectedStageMap,
        })
        clearSelection()
        // Surface failed-ids inline so the reviewer knows what to
        // retry / inspect.
        if (result.failed.length > 0) {
          setError(
            `${result.succeeded.length} succeeded, ${result.failed.length} failed. Reload to see the latest queue.`,
          )
        }
        router.refresh()
      } catch (e) {
        setError(getErrorMessage(e, 'Batch action failed.'))
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ['all', `全部 ${items.length}`],
            ['first', `待初审 ${items.length - finalCount}`],
            ['final', `待终审 ${finalCount}`],
          ] as const
        ).map(([key, label]) => {
          const active = stageFilter === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setStageFilter(key)
                clearSelection()
              }}
              className="ts-12 mono rounded px-3 py-1.5"
              style={{
                background: active ? 'var(--accent-soft)' : 'var(--panel2)',
                color: active ? 'var(--accent)' : 'var(--mute)',
                border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>
      {selected.size > 0 ? (
        <div
          className="ts-13 mono flex flex-wrap items-center gap-2 px-3 py-2 rounded"
          style={{
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent-line)',
            color: 'var(--text)',
            position: 'sticky',
            top: 8,
            zIndex: 5,
          }}
        >
          <span>{selected.size} selected</span>
          <span style={{ color: 'var(--mute2)' }}>·</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => applyBatch('approve')}
            className="ts-12 mono px-4 rounded inline-flex items-center justify-center gap-2"
            style={{
              minHeight: 40,
              background: 'oklch(0.6 0.18 280)',
              color: 'white',
              border: '1px solid oklch(0.6 0.18 280 / 0.6)',
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {pending ? 'Working…' : approvalLabel(selectedItems.length, selectedAcceptanceCount)}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null)
              setRevisionOpen(true)
            }}
            aria-expanded={revisionOpen}
            className="ts-12 mono px-4 rounded inline-flex items-center justify-center gap-2"
            style={{
              minHeight: 40,
              background: 'transparent',
              color: 'var(--danger)',
              border: '1px solid oklch(0.55 0.2 25 / 0.4)',
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            <RotateCcw size={14} />
            Send back…
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="ts-12 mono px-3 rounded ml-auto inline-flex items-center justify-center gap-2"
            style={{
              minHeight: 40,
              background: 'transparent',
              color: 'var(--mute)',
              border: '1px solid var(--line)',
              cursor: 'pointer',
            }}
          >
            <X size={14} />
            Clear
          </button>
        </div>
      ) : null}
      {selected.size > 0 && revisionOpen ? (
        <div
          className="rounded p-3"
          style={{
            background: 'var(--bg)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
          }}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div
                className="ts-12 mono inline-flex items-center gap-2"
                style={{ color: 'var(--danger)', fontWeight: 600 }}
              >
                <RotateCcw size={14} />
                SEND BACK REASON
              </div>
              <div className="ts-12 mt-1" style={{ color: 'var(--mute)' }}>
                This reason is written to the review thread and shown to the
                labeler before they revise the selected work.
              </div>
            </div>
            <div className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
              {selectedItems.length} selected
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {SEND_BACK_TEMPLATES.map((template) => (
              <button
                key={template}
                type="button"
                disabled={pending}
                onClick={() => setRevisionFeedback(template)}
                className="ts-11 mono px-2 rounded inline-flex items-center text-left"
                style={{
                  minHeight: 32,
                  background:
                    revisionFeedback === template
                      ? 'oklch(0.55 0.2 25 / 0.12)'
                      : 'var(--panel)',
                  color:
                    revisionFeedback === template
                      ? 'var(--danger)'
                      : 'var(--mute)',
                  border: `1px solid ${
                    revisionFeedback === template
                      ? 'oklch(0.55 0.2 25 / 0.45)'
                      : 'var(--line)'
                  }`,
                  cursor: pending ? 'not-allowed' : 'pointer',
                }}
              >
                {template.split(' — ')[0]}
              </button>
            ))}
          </div>
          <textarea
            value={revisionFeedback}
            onChange={(e) => setRevisionFeedback(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Example: The answer missed the safety check and the required rationale. Please update both fields before resubmitting."
            className="ts-13 mt-3 w-full rounded px-3 py-2"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
              outline: 'none',
              resize: 'vertical',
            }}
          />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="ts-12" style={{ color: 'var(--mute2)' }}>
              {selectedItems.slice(0, 3).map((item) => item.taskName).join(' · ')}
              {selectedItems.length > 3 ? ` · +${selectedItems.length - 3}` : ''}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setRevisionOpen(false)
                  setRevisionFeedback('')
                }}
                className="ts-12 mono rounded px-3"
                style={{
                  minHeight: 40,
                  background: 'transparent',
                  color: 'var(--mute)',
                  border: '1px solid var(--line)',
                  cursor: pending ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || revisionFeedback.trim().length === 0}
                onClick={() =>
                  applyBatch('request_revision', revisionFeedback)
                }
                className="ts-12 mono rounded px-3 inline-flex items-center justify-center gap-2"
                style={{
                  minHeight: 40,
                  background:
                    pending || revisionFeedback.trim().length === 0
                      ? 'var(--panel2)'
                      : 'var(--danger)',
                  color:
                    pending || revisionFeedback.trim().length === 0
                      ? 'var(--mute2)'
                      : 'white',
                  border: '1px solid oklch(0.55 0.2 25 / 0.45)',
                  cursor:
                    pending || revisionFeedback.trim().length === 0
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {pending ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                {pending ? 'Working…' : 'Send back selected'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {error ? (
        <div
          className="rounded p-2 ts-12"
          style={{
            background: 'oklch(0.55 0.2 25 / 0.05)',
            border: '1px solid oklch(0.55 0.2 25 / 0.4)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          overflowX: 'auto',
          // Tablet + mobile show a horizontal scrollbar when columns
          // don't fit. Desktop has plenty of room; we still keep the
          // wrapper so a stretched table never breaks layout.
          WebkitOverflowScrolling: 'touch',
        }}
      >
      <table
        className="ts-13"
        style={{
          borderCollapse: 'separate',
          borderSpacing: 0,
          width: '100%',
          minWidth: 720,
        }}
      >
        <thead>
          <tr style={{ color: 'var(--mute)' }}>
            <Th width={44}>
              <label
                className="inline-flex items-center justify-center"
                style={{ width: 40, height: 40, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  style={{
                    accentColor: 'oklch(0.6 0.18 280)',
                    width: 18,
                    height: 18,
                  }}
                  aria-label="Select all rows"
                />
              </label>
            </Th>
            <Th>Submitted</Th>
            <Th>Workspace · Task</Th>
            <Th>Annotator</Th>
            <Th>Stage</Th>
            <Th>AI verdict</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {visibleItems.map((item) => {
            const isSel = selected.has(item.annotationId)
            return (
              <tr
                key={item.annotationId}
                style={{
                  borderBottom: '1px solid var(--line)',
                  background: isSel ? 'var(--accent-soft)' : 'transparent',
                }}
              >
                <Td>
                  <label
                    className="inline-flex items-center justify-center"
                    style={{ width: 40, height: 40, cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleOne(item.annotationId)}
                      style={{
                        accentColor: 'oklch(0.6 0.18 280)',
                        width: 18,
                        height: 18,
                      }}
                      aria-label={`Select ${item.annotationId}`}
                    />
                  </label>
                </Td>
                <Td>
                  <span className="mono">{formatDate(item.submittedAt)}</span>
                </Td>
                <Td>
                  <div className="flex flex-col gap-0.5">
                    <span style={{ color: 'var(--text)' }}>{item.taskName}</span>
                    <span
                      className="ts-11"
                      style={{ color: 'var(--mute2)' }}
                    >
                      {item.workspaceName}
                    </span>
                  </div>
                </Td>
                <Td>
                  <span
                    className="ts-11 mono"
                    style={{ color: 'var(--mute2)' }}
                  >
                    {item.submitterEmail ??
                      (item.submitterId
                        ? item.submitterId.slice(0, 8)
                        : 'unknown')}
                  </span>
                </Td>
                <Td>
                  <StageBadge stage={item.status} />
                </Td>
                <Td>
                  <AiVerdictBadge
                    verdict={item.aiVerdict}
                    status={item.aiStatus}
                    priority={item.aiPriority}
                    score={item.aiScore}
                  />
                  {item.aiReasoning ? (
                    <div
                      className="ts-11 mt-0.5"
                      style={{ color: 'var(--mute2)' }}
                    >
                      {item.aiReasoning}
                    </div>
                  ) : null}
                </Td>
                <Td>
                  <Link
                    href={`/review/${item.annotationId}`}
                    className="ts-12 mono px-3 rounded inline-flex items-center gap-2"
                    style={{
                      minHeight: 36,
                      background: 'var(--panel2)',
                      border: '1px solid var(--line)',
                      color: 'var(--text)',
                      textDecoration: 'none',
                    }}
                  >
                    Open
                    <ArrowRight size={14} />
                  </Link>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}

function StageBadge({ stage }: { stage: string }) {
  const palette = (() => {
    if (stage === 'ai_review')
      return { bg: 'oklch(0.55 0.18 320 / 0.1)', fg: 'oklch(0.55 0.18 320)' }
    if (stage === 'reviewing')
      return { bg: 'var(--accent-soft)', fg: 'oklch(0.6 0.18 280)' }
    if (stage === 'awaiting_acceptance')
      return { bg: 'oklch(0.62 0.16 145 / 0.08)', fg: 'oklch(0.62 0.16 145)' }
    if (stage === 'submitted')
      return { bg: 'var(--panel2)', fg: 'var(--mute)' }
    return { bg: 'var(--panel2)', fg: 'var(--mute2)' }
  })()
  return (
      <span
        className="ts-11 mono px-2 py-0.5 rounded"
        style={{
          background: palette.bg,
          color: palette.fg,
          border: `1px solid ${palette.fg}33`,
        }}
      >
      {formatStage(stage)}
    </span>
  )
}

function AiVerdictBadge({
  verdict,
  status,
  priority,
  score,
}: {
  verdict: 'pass' | 'send_back' | 'human_review' | null
  status: 'pending' | 'completed' | 'failed' | null
  priority: boolean
  /** AI overall confidence, 0-100. Null when no scored verdict exists. */
  score: number | null
}) {
  if (status === 'pending') {
    return (
      <span
        className="ts-11 mono"
        style={{ color: 'var(--mute2)' }}
      >
        AI · pending
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span
        className="ts-11 mono"
        style={{ color: 'var(--danger)' }}
      >
        AI · failed
      </span>
    )
  }
  if (!verdict) {
    return (
      <span
        className="ts-11 mono"
        style={{ color: 'var(--mute2)' }}
      >
        —
      </span>
    )
  }
  const palette = (() => {
    if (verdict === 'pass')
      return { bg: 'oklch(0.62 0.16 145 / 0.08)', fg: 'oklch(0.62 0.16 145)' }
    if (verdict === 'send_back')
      return { bg: 'oklch(0.6 0.18 60 / 0.08)', fg: 'oklch(0.6 0.18 60)' }
    return { bg: 'oklch(0.55 0.18 320 / 0.1)', fg: 'oklch(0.55 0.18 320)' }
  })()
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="ts-11 mono px-2 py-0.5 rounded"
        style={{
          background: palette.bg,
          color: palette.fg,
          border: `1px solid ${palette.fg}55`,
        }}
      >
        {formatAiVerdict(verdict)}
      </span>
      {typeof score === 'number' ? (
        <span
          className="ts-11 mono"
          style={{ color: 'var(--mute2)' }}
          title="AI confidence"
        >
          {formatConfidence(score)}
        </span>
      ) : null}
      {priority ? (
        <span
          className="ts-11 mono inline-flex items-center gap-1"
          style={{ color: 'oklch(0.6 0.18 60)' }}
        >
          <Flag size={12} />
          priority
        </span>
      ) : null}
    </span>
  )
}

function formatStage(stage: string): string {
  return stageLabel(stage)
}

function approvalLabel(selectedCount: number, awaitingAcceptanceCount: number): string {
  if (awaitingAcceptanceCount === selectedCount) return 'Accept all'
  if (awaitingAcceptanceCount > 0) return 'Advance selected'
  return 'QC pass all'
}

function formatAiVerdict(
  verdict: 'pass' | 'send_back' | 'human_review',
): string {
  if (verdict === 'send_back') return 'Send back'
  if (verdict === 'human_review') return 'Human review'
  return 'Pass'
}

/**
 * The review agent emits `score` as 0-100 overall confidence. Render
 * it as a compact percentage; defensively handle a 0-1 fraction in
 * case an older verdict stored the normalized form.
 */
function formatConfidence(score: number): string {
  if (!Number.isFinite(score)) return ''
  const pct = score >= 0 && score <= 1 ? Math.round(score * 100) : Math.round(score)
  return `${Math.max(0, Math.min(100, pct))}%`
}

function Th({
  children,
  width,
}: {
  children?: React.ReactNode
  width?: number
}) {
  return (
    <th
      className="ts-11 mono text-left px-2 py-2"
      style={{
        borderBottom: '1px solid var(--line)',
        fontWeight: 'normal',
        width,
      }}
    >
      {children}
    </th>
  )
}

function Td({ children }: { children?: React.ReactNode }) {
  return <td className="px-2 py-2 align-top">{children}</td>
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ')
}
