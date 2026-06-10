'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckSquare, Flame, Square } from 'lucide-react'
import { claimTopics } from '@/lib/actions/topics'
import type { TopicQueueItem } from '@/lib/queries/topic-queue'

/**
 * Topic-queue list for /my/queue (spec §4.3 任务广场).
 *
 * Behavior-preserving wrapper around the original server-rendered list:
 * every card is still a Link straight to the annotate page (the existing
 * one-at-a-time "click a card → save auto-claims" path is untouched).
 *
 * What's new: `fresh` (claimable) topics get a checkbox, and a
 * "claim N selected" bar lets a labeler grab several at once via the
 * `claimTopics` server action — which reuses the exact same per-topic
 * safety primitives as the single claim (status gate + quota + atomic
 * CAS) and reports partial results so a row that lost the race or hit
 * quota just gets skipped, not the whole batch.
 *
 * Only `fresh` rows are selectable. `mine` / `submitted` rows render
 * exactly as before — no checkbox, no behavior change.
 */
export function QueueTopicList({ items }: { items: TopicQueueItem[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const freshIds = useMemo(
    () => items.filter((it) => it.state === 'fresh').map((it) => it.topicId),
    [items],
  )

  function toggle(topicId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(topicId)) next.delete(topicId)
      else next.add(topicId)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === freshIds.length ? new Set() : new Set(freshIds),
    )
  }

  function claimSelected() {
    const topicIds = Array.from(selected)
    if (topicIds.length === 0 || pending) return
    setError(null)
    setNotice(null)
    start(async () => {
      try {
        const res = await claimTopics({ topicIds })
        const parts: string[] = []
        if (res.claimed.length > 0) {
          parts.push(`Claimed ${res.claimed.length}`)
        }
        if (res.skipped.length > 0) {
          parts.push(`skipped ${res.skipped.length}`)
        }
        setNotice(parts.length > 0 ? parts.join(' · ') : 'Nothing to claim.')
        setSelected(new Set())
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  const selectedCount = selected.size

  return (
    <div className="flex flex-col gap-3">
      {freshIds.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-lg px-3 py-2"
          style={{
            background: 'var(--panel2)',
            border: '1px solid var(--line)',
          }}
        >
          <button
            type="button"
            onClick={toggleAll}
            className="ts-12 mono inline-flex items-center gap-1.5"
            style={{
              background: 'transparent',
              color: 'var(--mute)',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {selectedCount > 0 && selectedCount === freshIds.length ? (
              <CheckSquare size={14} aria-hidden />
            ) : (
              <Square size={14} aria-hidden />
            )}
            select all open ({freshIds.length})
          </button>
          <button
            type="button"
            disabled={selectedCount === 0 || pending}
            onClick={claimSelected}
            className="ts-12 mono inline-flex items-center gap-1.5 ml-auto"
            style={{
              background:
                selectedCount === 0 ? 'var(--panel)' : 'var(--accent-soft)',
              color: selectedCount === 0 ? 'var(--mute2)' : 'var(--accent)',
              border: `1px solid ${
                selectedCount === 0 ? 'var(--line)' : 'var(--accent-line)'
              }`,
              borderRadius: 6,
              padding: '6px 14px',
              fontWeight: 600,
              cursor:
                selectedCount === 0 || pending ? 'not-allowed' : 'pointer',
              opacity: pending ? 0.7 : 1,
            }}
          >
            {pending
              ? 'claiming…'
              : `claim ${selectedCount} selected`}
          </button>
        </div>
      )}

      {(error || notice) && (
        <p
          className="ts-12 rounded-lg px-3 py-2"
          style={
            error
              ? { color: 'var(--danger)', background: 'var(--danger-soft)' }
              : { color: 'var(--accent)', background: 'var(--accent-soft)' }
          }
        >
          {error ?? notice}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const accent =
            item.state === 'mine'
              ? 'oklch(0.7 0.14 75 / 0.4)'
              : item.state === 'submitted'
                ? 'oklch(0.55 0 0 / 0.4)'
                : 'var(--line)'
          const stateLabel =
            item.state === 'mine'
              ? 'resume'
              : item.state === 'submitted'
                ? 'submitted'
                : 'claim'
          const stateColor =
            item.state === 'mine'
              ? 'oklch(0.7 0.14 75)'
              : item.state === 'submitted'
                ? 'var(--mute2)'
                : 'oklch(0.65 0.18 200)'
          const selectable = item.state === 'fresh'
          const isSelected = selected.has(item.topicId)
          return (
            <li key={item.topicId} className="flex items-stretch gap-2">
              {selectable && (
                <button
                  type="button"
                  aria-label={
                    isSelected ? 'Deselect topic' : 'Select topic to claim'
                  }
                  aria-pressed={isSelected}
                  onClick={() => toggle(item.topicId)}
                  className="shrink-0 inline-flex items-center justify-center rounded-lg"
                  style={{
                    width: 38,
                    background: isSelected
                      ? 'var(--accent-soft)'
                      : 'var(--panel)',
                    border: `1px solid ${
                      isSelected ? 'var(--accent-line)' : 'var(--line)'
                    }`,
                    color: isSelected ? 'var(--accent)' : 'var(--mute2)',
                    cursor: 'pointer',
                  }}
                >
                  {isSelected ? (
                    <CheckSquare size={16} aria-hidden />
                  ) : (
                    <Square size={16} aria-hidden />
                  )}
                </button>
              )}
              <Link
                href={`/workspaces/${item.workspaceId}/topics/${item.topicId}/annotate`}
                className="block rounded-xl p-4 flex-1"
                style={{
                  background: 'var(--panel)',
                  border: `1px solid ${isSelected ? 'var(--accent-line)' : accent}`,
                  textDecoration: 'none',
                  transition: 'border-color 120ms',
                }}
              >
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <div className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
                    {item.workspaceName} · {item.taskName}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.difficulty != null && (
                      <DifficultyChip
                        difficulty={item.difficulty}
                        reason={item.difficultyReason}
                      />
                    )}
                    <span
                      className="mono ts-11 px-2 py-0.5 rounded"
                      style={{
                        background: 'oklch(0.6 0.18 280 / 0.1)',
                        color: 'var(--accent)',
                        border: '1px solid oklch(0.6 0.18 280 / 0.25)',
                      }}
                    >
                      {item.templateMode.toUpperCase()}
                    </span>
                    <span
                      className="mono ts-11"
                      style={{ color: stateColor, fontWeight: 600 }}
                    >
                      {stateLabel}
                    </span>
                  </div>
                </div>
                <p
                  className="ts-13"
                  style={{ color: 'var(--text)', lineHeight: 1.5 }}
                >
                  {item.promptPreview}
                </p>
                <div
                  className="ts-11 mono mt-2"
                  style={{ color: 'var(--mute2)' }}
                >
                  status {item.topicStatus} ·{' '}
                  {item.createdAt.toISOString().slice(0, 10)}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Difficulty chip surfaced on each queue card — gives the annotator a
 * heads-up about how hard the AI thinks the topic is so they can plan
 * their session. Color ramp tracks the payout multiplier:
 *   1-2 (cheap)  → muted gray
 *   3   (normal) → neutral
 *   4   (harder) → warm yellow
 *   5   (expert) → red, "this one pays"
 */
function DifficultyChip({
  difficulty,
  reason,
}: {
  difficulty: number
  reason: string | null
}) {
  const palette: Record<number, { bg: string; fg: string; label: string }> = {
    1: { bg: 'oklch(0.5 0 0 / 0.1)', fg: 'oklch(0.6 0 0)', label: 'easy' },
    2: { bg: 'oklch(0.5 0 0 / 0.12)', fg: 'oklch(0.5 0 0)', label: 'light' },
    3: {
      bg: 'oklch(0.55 0 0 / 0.14)',
      fg: 'oklch(0.45 0 0)',
      label: 'standard',
    },
    4: {
      bg: 'oklch(0.7 0.14 75 / 0.15)',
      fg: 'oklch(0.55 0.14 75)',
      label: 'hard',
    },
    5: {
      bg: 'oklch(0.55 0.2 25 / 0.15)',
      fg: 'var(--danger)',
      label: 'expert',
    },
  }
  const p = palette[Math.max(1, Math.min(5, difficulty))]
  return (
    <span
      className="mono ts-11 px-2 py-0.5 rounded inline-flex items-center gap-1"
      style={{
        background: p.bg,
        color: p.fg,
        border: `1px solid ${p.fg}33`,
      }}
      title={reason ?? `AI rated this topic difficulty ${difficulty}/5`}
    >
      <Flame size={12} aria-hidden />
      <span>
        {p.label} · {difficulty}/5
      </span>
    </span>
  )
}
