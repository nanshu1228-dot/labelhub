import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import {
  getMyTaskDetail,
  type MyTaskTopicRow,
} from '@/lib/queries/my-tasks'

export const metadata: Metadata = {
  title: 'Task — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /my/tasks/[taskId] — drill-down for ONE task.
 *
 * Layout:
 *   1. Header — task name, workspace, mode, reward, deadline countdown
 *   2. Guidelines collapsible — surfaced inline so labelers don't have
 *      to context-switch before claiming a topic
 *   3. Topic list — sorted my-drafts → claimable → submitted → others,
 *      with difficulty chip on each row + state-aware CTA
 *
 * The "claim" action is implicit — clicking a topic links to the
 * annotate page, which auto-claims on first save. We don't need a
 * separate atomic claim button.
 */
export default async function MyTaskDetailPage(props: {
  params: Promise<{ taskId: string }>
  searchParams?: Promise<{ filter?: string }>
}) {
  const { taskId } = await props.params
  const search = (await props.searchParams) ?? {}
  const filter =
    search.filter === 'mine' ||
    search.filter === 'fresh' ||
    search.filter === 'submitted'
      ? search.filter
      : 'all'

  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/my/tasks/${taskId}`)

  const detail = await getMyTaskDetail({ userId: me.id, taskId })
  if (!detail) notFound()

  const visible =
    filter === 'all'
      ? detail.topics
      : detail.topics.filter((t) => t.state === filter)

  const dueText = detail.task.deadline
    ? formatDeadline(detail.task.deadline)
    : null

  return (
    <main
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <div className="mx-auto max-w-[1100px]">
        <nav
          className="ts-12 mono flex items-center gap-1.5 mb-4"
          style={{ color: 'var(--mute2)' }}
        >
          <Link
            href="/my/tasks"
            className="hover:underline"
            style={{ color: 'var(--mute)' }}
          >
            my tasks
          </Link>
          <span>·</span>
          <span style={{ color: 'var(--text)' }}>{detail.task.name}</span>
        </nav>

        <div className="mb-1 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="lbl">§ {detail.task.workspaceName.toUpperCase()}</div>
            <h1
              className="ts-28 mt-1"
              style={{ color: 'var(--hi)', fontWeight: 500 }}
            >
              {detail.task.name}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <span
              className="mono ts-11 px-2 py-0.5 rounded"
              style={{
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                border: '1px solid var(--accent-line)',
              }}
            >
              {detail.task.templateMode}
            </span>
            {detail.task.rewardPerTopic != null && (
              <span
                className="mono ts-11 px-2 py-0.5 rounded"
                style={{
                  background: 'oklch(0.5 0.13 150 / 0.1)',
                  color: 'oklch(0.45 0.15 150)',
                  border: '1px solid oklch(0.5 0.13 150 / 0.35)',
                }}
              >
                💰 {detail.task.rewardPerTopic.toFixed(2)}{' '}
                {detail.task.currency} / topic
              </span>
            )}
            {dueText && (
              <span
                className="mono ts-11 px-2 py-0.5 rounded"
                style={{
                  background:
                    dueText.urgency === 'today' || dueText.urgency === 'overdue'
                      ? 'var(--danger-soft)'
                      : 'var(--panel2)',
                  color:
                    dueText.urgency === 'today' || dueText.urgency === 'overdue'
                      ? 'var(--danger)'
                      : 'var(--mute)',
                  border: `1px solid ${
                    dueText.urgency === 'today' || dueText.urgency === 'overdue'
                      ? 'oklch(0.55 0.2 25 / 0.35)'
                      : 'var(--line)'
                  }`,
                }}
              >
                ⏱ {dueText.label}
              </span>
            )}
          </div>
        </div>

        {detail.task.description && (
          <p
            className="ts-13 mt-2 mb-4"
            style={{ color: 'var(--mute)', maxWidth: 760 }}
          >
            {detail.task.description}
          </p>
        )}

        {detail.task.guidelinesMarkdown && (
          <details
            className="rounded-md mb-6"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            <summary
              className="ts-12 mono px-3 py-2 cursor-pointer"
              style={{ color: 'var(--mute)' }}
            >
              guidelines ({detail.task.guidelinesMarkdown.length} chars) — click to expand
            </summary>
            <pre
              className="ts-12 mono px-4 py-3 whitespace-pre-wrap"
              style={{
                color: 'var(--text)',
                borderTop: '1px solid var(--line)',
                maxHeight: 360,
                overflow: 'auto',
              }}
            >
              {detail.task.guidelinesMarkdown}
            </pre>
          </details>
        )}

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <FilterChip
            href={`/my/tasks/${taskId}`}
            active={filter === 'all'}
            label="all"
            count={detail.topics.length}
          />
          <FilterChip
            href={`/my/tasks/${taskId}?filter=fresh`}
            active={filter === 'fresh'}
            label="claimable"
            count={detail.counts.fresh}
            tone="accent"
          />
          <FilterChip
            href={`/my/tasks/${taskId}?filter=mine`}
            active={filter === 'mine'}
            label="mine"
            count={detail.counts.mine}
            tone="warn"
          />
          <FilterChip
            href={`/my/tasks/${taskId}?filter=submitted`}
            active={filter === 'submitted'}
            label="submitted"
            count={detail.counts.submitted}
            tone="muted"
          />
        </div>

        {visible.length === 0 ? (
          <div
            className="rounded-md px-4 py-8 text-center ts-13 mono"
            style={{
              background: 'var(--panel)',
              border: '1px dashed var(--line2)',
              color: 'var(--mute)',
            }}
          >
            No topics in this filter.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((t) => (
              <TopicRow
                key={t.topicId}
                topic={t}
                workspaceId={detail.task.workspaceId}
              />
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}

function FilterChip({
  href,
  active,
  label,
  count,
  tone,
}: {
  href: string
  active: boolean
  label: string
  count: number
  tone?: 'accent' | 'warn' | 'muted'
}) {
  const palette = {
    accent: {
      fg: 'var(--accent)',
      line: 'var(--accent-line)',
      bg: 'var(--accent-soft)',
    },
    warn: {
      fg: 'oklch(0.55 0.14 75)',
      line: 'oklch(0.6 0.14 75 / 0.4)',
      bg: 'oklch(0.6 0.14 75 / 0.1)',
    },
    muted: {
      fg: 'var(--mute2)',
      line: 'var(--line)',
      bg: 'var(--panel)',
    },
    default: {
      fg: 'var(--mute)',
      line: 'var(--line)',
      bg: 'var(--panel)',
    },
  }[tone ?? 'default']
  return (
    <Link
      href={href}
      className="ts-12 mono px-3 py-1.5 rounded-full"
      style={{
        background: active ? palette.bg : 'var(--panel)',
        color: active ? palette.fg : 'var(--mute)',
        border: `1px solid ${active ? palette.line : 'var(--line)'}`,
        textDecoration: 'none',
      }}
    >
      {label} · {count}
    </Link>
  )
}

function TopicRow({
  topic,
  workspaceId,
}: {
  topic: MyTaskTopicRow
  workspaceId: string
}) {
  const stateConfig = {
    mine: {
      label: 'resume',
      fg: 'oklch(0.55 0.14 75)',
      bg: 'oklch(0.6 0.14 75 / 0.1)',
      line: 'oklch(0.6 0.14 75 / 0.4)',
    },
    fresh: {
      label: 'claim',
      fg: 'oklch(0.65 0.18 200)',
      bg: 'oklch(0.65 0.18 200 / 0.1)',
      line: 'oklch(0.65 0.18 200 / 0.35)',
    },
    submitted: {
      label: 'submitted',
      fg: 'var(--mute2)',
      bg: 'var(--panel2)',
      line: 'var(--line)',
    },
    others: {
      label: 'taken',
      fg: 'var(--mute2)',
      bg: 'var(--panel2)',
      line: 'var(--line)',
    },
  }[topic.state]

  const pickable = topic.state !== 'others'
  const content = (
    <div
      className="rounded-md px-4 py-3 flex items-start gap-3"
      style={{
        background: 'var(--panel)',
        border: `1px solid ${stateConfig.line}`,
        opacity: topic.state === 'others' ? 0.5 : 1,
      }}
    >
      <span
        className="mono ts-11 shrink-0 px-2 py-0.5 rounded"
        style={{
          background: stateConfig.bg,
          color: stateConfig.fg,
          border: `1px solid ${stateConfig.line}`,
          fontWeight: 600,
          minWidth: 78,
          textAlign: 'center',
        }}
      >
        {stateConfig.label}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="ts-13"
          style={{
            color: 'var(--text)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {topic.promptPreview}
        </p>
        <div
          className="ts-11 mono mt-1 flex items-center gap-2 flex-wrap"
          style={{ color: 'var(--mute2)' }}
        >
          {topic.difficulty != null && (
            <span
              className="px-1.5 py-0.5 rounded"
              style={{
                background: difficultyBg(topic.difficulty),
                color: difficultyFg(topic.difficulty),
                border: `1px solid ${difficultyFg(topic.difficulty)}44`,
              }}
              title={
                topic.difficultyReason ??
                `AI difficulty ${topic.difficulty}/5`
              }
            >
              🔥 {difficultyLabel(topic.difficulty)} · {topic.difficulty}/5
            </span>
          )}
          <span>{topic.createdAt.toISOString().slice(0, 10)}</span>
        </div>
      </div>
    </div>
  )

  if (!pickable) {
    return <li>{content}</li>
  }
  return (
    <li>
      <Link
        href={`/workspaces/${workspaceId}/topics/${topic.topicId}/annotate`}
        style={{ textDecoration: 'none' }}
      >
        {content}
      </Link>
    </li>
  )
}

function difficultyLabel(n: number): string {
  return ['easy', 'light', 'standard', 'hard', 'expert'][
    Math.max(0, Math.min(4, n - 1))
  ]
}
function difficultyFg(n: number): string {
  if (n <= 2) return 'var(--mute)'
  if (n === 3) return 'var(--text)'
  if (n === 4) return 'oklch(0.55 0.14 75)'
  return 'var(--danger)'
}
function difficultyBg(n: number): string {
  if (n <= 2) return 'var(--panel2)'
  if (n === 3) return 'var(--panel2)'
  if (n === 4) return 'oklch(0.6 0.14 75 / 0.1)'
  return 'oklch(0.55 0.2 25 / 0.1)'
}

function formatDeadline(d: Date): {
  label: string
  urgency: 'overdue' | 'today' | 'soon' | 'later'
} {
  const ms = d.getTime() - Date.now()
  if (ms < 0) return { label: 'overdue', urgency: 'overdue' }
  const days = Math.floor(ms / (24 * 3600 * 1000))
  if (days === 0) return { label: 'closes today', urgency: 'today' }
  if (days <= 2) return { label: `closes in ${days}d`, urgency: 'soon' }
  return { label: `closes in ${days}d`, urgency: 'later' }
}
