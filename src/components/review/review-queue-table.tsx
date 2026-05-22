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
  batchReviewAnnotations,
  type BatchDecision,
} from '@/lib/actions/review-batch'
import type { ReviewQueueItem } from '@/lib/queries/review-queue'

export function ReviewQueueTable({
  items,
}: {
  items: ReviewQueueItem[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const allSelected = items.length > 0 && selected.size === items.length
  const [pending, startBatch] = useTransition()
  const [error, setError] = useState<string | null>(null)
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
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.annotationId)))
  }

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.annotationId)),
    [items, selected],
  )

  async function applyBatch(decision: BatchDecision) {
    setError(null)
    if (selectedItems.length === 0) return
    if (
      decision === 'request_revision' &&
      typeof window !== 'undefined' &&
      !confirmReason(selectedItems.length)
    ) {
      return
    }
    let reason: string | undefined
    if (decision === 'request_revision') {
      reason =
        typeof window !== 'undefined'
          ? window.prompt(
              `Reason for sending ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'} back?`,
              '',
            ) ?? ''
          : ''
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
        })
        setSelected(new Set())
        // Surface failed-ids inline so the reviewer knows what to
        // retry / inspect.
        if (result.failed.length > 0) {
          setError(
            `${result.succeeded.length} succeeded, ${result.failed.length} failed. Reload to see the latest queue.`,
          )
        }
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Batch action failed.')
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {selected.size > 0 ? (
        <div
          className="ts-13 mono flex items-center gap-3 px-3 py-2 rounded"
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
            className="ts-12 mono px-4 rounded inline-flex items-center justify-center"
            style={{
              minHeight: 40,
              background: 'oklch(0.6 0.18 280)',
              color: 'white',
              border: '1px solid oklch(0.6 0.18 280 / 0.6)',
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            {pending ? 'Working…' : 'Approve all'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => applyBatch('request_revision')}
            className="ts-12 mono px-4 rounded inline-flex items-center justify-center"
            style={{
              minHeight: 40,
              background: 'transparent',
              color: 'var(--danger)',
              border: '1px solid oklch(0.55 0.2 25 / 0.4)',
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            Send back…
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ts-12 mono px-3 rounded ml-auto inline-flex items-center justify-center"
            style={{
              minHeight: 40,
              background: 'transparent',
              color: 'var(--mute)',
              border: '1px solid var(--line)',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
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
          {items.map((item) => {
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
                    className="ts-12 mono px-3 rounded inline-flex items-center"
                    style={{
                      minHeight: 36,
                      background: 'var(--panel2)',
                      border: '1px solid var(--line)',
                      color: 'var(--text)',
                      textDecoration: 'none',
                    }}
                  >
                    Open →
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

function confirmReason(count: number): boolean {
  return window.confirm(
    `Send ${count} item${count === 1 ? '' : 's'} back? You'll be asked for a reason next.`,
  )
}

function StageBadge({ stage }: { stage: string }) {
  const palette = (() => {
    if (stage === 'ai_review')
      return { bg: 'oklch(0.55 0.18 320 / 0.1)', fg: 'oklch(0.55 0.18 320)' }
    if (stage === 'reviewing')
      return { bg: 'var(--accent-soft)', fg: 'oklch(0.6 0.18 280)' }
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
      {stage}
    </span>
  )
}

function AiVerdictBadge({
  verdict,
  status,
  priority,
}: {
  verdict: 'pass' | 'send_back' | 'human_review' | null
  status: 'pending' | 'completed' | 'failed' | null
  priority: boolean
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
        {verdict}
      </span>
      {priority ? (
        <span className="ts-11 mono" style={{ color: 'oklch(0.6 0.18 60)' }}>
          ⚑ priority
        </span>
      ) : null}
    </span>
  )
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
