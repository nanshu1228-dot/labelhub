'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { restoreAnnotationRevision } from '@/lib/actions/annotation-revisions'

type RevisionRow = {
  id: string
  ts: Date
  kind: string
  actorId: string
  actorDisplayName: string | null
  actorEmail: string | null
  byteSize: number
  prevRevisionId: string | null
}

type AnnotationList = {
  annotationId: string
  raterDisplayName: string | null
  raterEmail: string | null
  revisions: RevisionRow[]
}

/**
 * Renders the timeline + restore controls. Each annotation gets its
 * own card with the revisions stacked chronologically. Restore-from
 * triggers a modal-ish confirm that requires a reason (surfaced to
 * the rater verbatim via the notification system).
 *
 * UX deliberately keeps the timeline compact: kind chip + when +
 * who + size. Hovering shows the absolute timestamp; clicking
 * "restore" prompts for a reason. Successive revisions of the same
 * kind+actor in a tight window get visually grouped so a
 * burst-clicking rater doesn't generate 20 identical-looking rows.
 */
export function HistoryClient({ lists }: { lists: AnnotationList[] }) {
  return (
    <div className="flex flex-col gap-6">
      {lists.map((a) => (
        <AnnotationCard key={a.annotationId} list={a} />
      ))}
    </div>
  )
}

function AnnotationCard({ list }: { list: AnnotationList }) {
  const router = useRouter()
  const [chosenRevId, setChosenRevId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const raterName =
    list.raterDisplayName ??
    list.raterEmail?.split('@')[0] ??
    list.annotationId.slice(0, 8)

  function doRestore() {
    if (!chosenRevId) return
    if (!reason.trim()) {
      setError("Add a reason — the rater will see this in their inbox.")
      return
    }
    setError(null)
    setInfo(null)
    startTransition(async () => {
      try {
        await restoreAnnotationRevision({
          revisionId: chosenRevId,
          reason: reason.trim(),
        })
        setInfo(
          `Restored. ${raterName} got a notification with your reason.`,
        )
        setChosenRevId(null)
        setReason('')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Restore failed.')
      }
    })
  }

  return (
    <section
      className="rounded-xl p-5"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2
          className="ts-16"
          style={{ color: 'var(--hi)', fontWeight: 500 }}
        >
          {raterName}&apos;s annotation
        </h2>
        <span
          className="ts-11 mono"
          style={{ color: 'var(--mute2)' }}
        >
          {list.revisions.length} revision{list.revisions.length === 1 ? '' : 's'}
        </span>
      </div>

      {list.revisions.length === 0 ? (
        <div
          className="ts-12 mono text-center py-6"
          style={{ color: 'var(--mute2)' }}
        >
          No revisions yet — first save lands here once the rater starts.
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.revisions.map((r, idx) => {
            const isLatest = idx === 0
            const actorName =
              r.actorDisplayName ??
              r.actorEmail?.split('@')[0] ??
              r.actorId.slice(0, 8)
            return (
              <li
                key={r.id}
                className="rounded-md px-3 py-2 flex items-center gap-3"
                style={{
                  background: isLatest ? 'var(--accent-soft)' : 'var(--bg)',
                  border: `1px solid ${
                    isLatest ? 'var(--accent-line)' : 'var(--line)'
                  }`,
                }}
              >
                <KindChip kind={r.kind} />
                <div className="min-w-0 flex-1">
                  <div
                    className="ts-12 mono"
                    style={{ color: 'var(--text)' }}
                  >
                    {relativeTime(r.ts)} · {actorName}
                  </div>
                  <div
                    className="ts-11 mono"
                    style={{ color: 'var(--mute2)' }}
                    title={r.ts.toISOString()}
                  >
                    {r.ts.toLocaleString(undefined, { hour12: false })}
                    {' · '}
                    {(r.byteSize / 1024).toFixed(1)}KB
                  </div>
                </div>
                {isLatest ? (
                  <span
                    className="ts-11 mono shrink-0"
                    style={{ color: 'var(--mute2)' }}
                  >
                    current
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setChosenRevId(r.id)
                      setReason('')
                      setError(null)
                      setInfo(null)
                    }}
                    className="ts-12 mono shrink-0"
                    style={{
                      background: 'transparent',
                      color: 'var(--accent)',
                      border: '1px solid var(--accent-line)',
                      borderRadius: 5,
                      padding: '4px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    restore
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {chosenRevId && (
        <div
          className="rounded-md p-4 mt-3"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--accent-line)',
          }}
        >
          <div
            className="lbl mb-1.5"
            style={{ color: 'var(--accent)' }}
          >
            § RESTORE TO THIS VERSION
          </div>
          <p
            className="ts-12 mb-2"
            style={{ color: 'var(--mute)' }}
          >
            The live annotation will be rolled back to the picked
            snapshot. The rater gets a notification with your reason.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Why this restore? (shown to the rater verbatim)"
            className="w-full px-3 py-2 ts-13 rounded-md"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
              outline: 'none',
              resize: 'vertical',
            }}
          />
          {error && (
            <div
              className="ts-12 mono mt-2 p-2 rounded"
              style={{
                background: 'var(--danger-soft)',
                border: '1px solid oklch(0.55 0.2 25 / 0.35)',
                color: 'var(--danger)',
              }}
            >
              {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => {
                setChosenRevId(null)
                setReason('')
                setError(null)
              }}
              className="ts-13 mono"
              style={{
                background: 'transparent',
                color: 'var(--mute)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                padding: '6px 14px',
                cursor: 'pointer',
              }}
            >
              cancel
            </button>
            <button
              type="button"
              onClick={doRestore}
              disabled={pending}
              className="ts-13 mono"
              style={{
                background: 'var(--accent)',
                color: 'white',
                border: '1px solid var(--accent)',
                borderRadius: 6,
                padding: '6px 14px',
                fontWeight: 500,
                cursor: pending ? 'not-allowed' : 'pointer',
                opacity: pending ? 0.6 : 1,
              }}
            >
              {pending ? 'restoring…' : 'confirm restore'}
            </button>
          </div>
        </div>
      )}

      {info && (
        <div
          className="ts-12 mono mt-3 p-2 rounded"
          style={{
            background: 'var(--success-soft)',
            border: '1px solid oklch(0.5 0.13 150 / 0.35)',
            color: 'oklch(0.45 0.15 150)',
          }}
        >
          {info}
        </div>
      )}
    </section>
  )
}

function KindChip({ kind }: { kind: string }) {
  const palette: Record<
    string,
    { label: string; fg: string; bg: string }
  > = {
    autosave: {
      label: 'autosave',
      fg: 'var(--mute)',
      bg: 'var(--panel2)',
    },
    manual: {
      label: '📌 manual',
      fg: 'var(--accent)',
      bg: 'var(--accent-soft)',
    },
    submit: {
      label: '✓ submit',
      fg: 'oklch(0.5 0.13 150)',
      bg: 'oklch(0.5 0.13 150 / 0.1)',
    },
    restore: {
      label: '↺ restore',
      fg: 'oklch(0.6 0.18 280)',
      bg: 'oklch(0.6 0.18 280 / 0.1)',
    },
  }
  const p =
    palette[kind] ?? {
      label: kind,
      fg: 'var(--mute)',
      bg: 'var(--panel2)',
    }
  return (
    <span
      className="mono ts-11 px-2 py-0.5 rounded shrink-0"
      style={{
        color: p.fg,
        background: p.bg,
        border: `1px solid ${p.fg}44`,
        minWidth: 70,
        textAlign: 'center',
        fontWeight: 600,
      }}
    >
      {p.label}
    </span>
  )
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days}d ago`
  return d.toISOString().slice(5, 10).replace('-', '/')
}
