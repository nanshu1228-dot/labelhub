import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { listMyTasks } from '@/lib/queries/my-tasks'
import { countUnreadNotifications } from '@/lib/queries/notifications'

export const metadata: Metadata = {
  title: 'My tasks — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /my/tasks — annotator's PRIMARY entry point.
 *
 * Card per task (campaign), showing reward / claimable count / progress
 * / deadline. The labeler picks the task that fits their availability
 * and expertise; the per-task drill-down (/my/tasks/[taskId]) is where
 * they actually claim topics and start annotating.
 *
 * This replaces the flat /my/queue as the primary entry — labelers in
 * the wild think in terms of campaigns ("which task am I working on
 * tonight"), not a global feed.
 */
export default async function MyTasksPage() {
  const me = await optionalUser()
  if (!me) redirect('/signin?next=/my/tasks')

  const [tasks, unreadInbox] = await Promise.all([
    listMyTasks({ userId: me.id }),
    countUnreadNotifications(me.id).catch(() => 0),
  ])

  // Split open-with-work vs closed/depleted so the UI can group them.
  const active = tasks.filter((t) => t.claimableCount > 0)
  const depleted = tasks.filter((t) => t.claimableCount === 0)

  return (
    <main
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="lbl mb-2">§ MY TASKS</div>
            <h1 className="ts-32" style={{ color: 'var(--hi)' }}>
              Pick a campaign
            </h1>
            <p
              className="ts-13 mt-1"
              style={{ color: 'var(--mute)', maxWidth: 640 }}
            >
              Each card is a task you can work on. Pick one to see the
              available topics, claim them one at a time, and start
              labeling. Tasks with no claimable topics drop to the
              bottom — admin may have closed them or other raters
              cleared the queue.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <InboxLink unread={unreadInbox} />
            <Link
              href="/my/submissions"
              className="ts-12 mono"
              style={{
                background: 'var(--panel)',
                color: 'var(--mute)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                padding: '6px 12px',
                textDecoration: 'none',
              }}
            >
              history →
            </Link>
            <Link
              href="/my/queue"
              className="ts-12 mono"
              style={{
                background: 'var(--panel)',
                color: 'var(--mute)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                padding: '6px 12px',
                textDecoration: 'none',
              }}
              title="Flat view across all tasks — useful for browsing"
            >
              flat queue →
            </Link>
          </div>
        </div>

        {unreadInbox > 0 && <InboxBanner unread={unreadInbox} />}

        {tasks.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {active.length > 0 && (
              <section className="mb-8">
                <div className="lbl mb-3">
                  § ACTIVE · {active.length} task{active.length === 1 ? '' : 's'} ready
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {active.map((t) => (
                    <TaskCard key={t.taskId} task={t} />
                  ))}
                </ul>
              </section>
            )}
            {depleted.length > 0 && (
              <section>
                <div className="lbl mb-3">
                  § QUIET · {depleted.length} task{depleted.length === 1 ? '' : 's'} with no claimable topics
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {depleted.map((t) => (
                    <TaskCard key={t.taskId} task={t} muted />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function TaskCard({
  task,
  muted,
}: {
  task: Awaited<ReturnType<typeof listMyTasks>>[number]
  muted?: boolean
}) {
  const dueText = task.deadline
    ? formatDeadline(task.deadline)
    : null
  const progressPct =
    task.totalTopics === 0
      ? 0
      : Math.round((task.mySubmittedCount / task.totalTopics) * 100)
  return (
    <li>
      <Link
        href={`/my/tasks/${task.taskId}`}
        className="block rounded-xl p-4 h-full"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          textDecoration: 'none',
          opacity: muted ? 0.65 : 1,
          transition: 'border-color 120ms, transform 120ms',
        }}
      >
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span
            className="ts-11 mono"
            style={{ color: 'var(--mute2)' }}
          >
            {task.workspaceName}
          </span>
          <span
            className="mono ts-11 px-2 py-0.5 rounded"
            style={{
              background: 'oklch(0.6 0.18 280 / 0.08)',
              color: 'var(--accent)',
              border: '1px solid var(--accent-line)',
            }}
          >
            {task.templateMode}
          </span>
        </div>
        <h3
          className="ts-15 mb-1"
          style={{ color: 'var(--hi)', fontWeight: 500 }}
        >
          {task.taskName}
        </h3>
        {task.taskDescription && (
          <p
            className="ts-12 mb-3"
            style={{
              color: 'var(--mute)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {task.taskDescription}
          </p>
        )}
        <div className="grid grid-cols-3 gap-3 mt-3">
          <Mini
            label="REWARD"
            value={
              task.rewardPerTopic != null
                ? `${task.rewardPerTopic.toFixed(2)} ${task.currency ?? ''}`.trim()
                : '—'
            }
            sub="per topic"
            accent={!muted}
          />
          <Mini
            label="CLAIMABLE"
            value={String(task.claimableCount)}
            sub={`of ${task.totalTopics} total`}
            accent={task.claimableCount > 0}
          />
          <Mini
            label="MY PROGRESS"
            value={
              task.totalTopics === 0
                ? '—'
                : `${task.mySubmittedCount}/${task.totalTopics}`
            }
            sub={`${progressPct}% done`}
          />
        </div>
        {dueText && (
          <div
            className="ts-11 mono mt-3"
            style={{
              color:
                dueText.urgency === 'today' || dueText.urgency === 'overdue'
                  ? 'var(--danger)'
                  : 'var(--mute2)',
            }}
          >
            ⏱ {dueText.label}
          </div>
        )}
      </Link>
    </li>
  )
}

function Mini({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub: string
  accent?: boolean
}) {
  return (
    <div>
      <div
        className="ts-11 mono"
        style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
      >
        {label}
      </div>
      <div
        className="ts-15 mono mt-0.5"
        style={{
          color: accent ? 'var(--accent)' : 'var(--text)',
          fontWeight: 600,
        }}
      >
        {value}
      </div>
      <div
        className="ts-11 mono"
        style={{ color: 'var(--mute2)' }}
      >
        {sub}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div
      className="rounded-md px-6 py-12 text-center"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line2)',
      }}
    >
      <div
        className="ts-32 mb-2"
        style={{ color: 'var(--mute2)', fontWeight: 300 }}
        aria-hidden
      >
        ◌
      </div>
      <div
        className="ts-14"
        style={{ color: 'var(--text)', fontWeight: 500 }}
      >
        No tasks available yet
      </div>
      <p
        className="ts-12 mt-1 mx-auto"
        style={{ color: 'var(--mute)', maxWidth: 360 }}
      >
        You&apos;re not in any workspaces with open pair-rubric or
        arena-gsb tasks. Ask an admin to invite you, or claim a demo
        workspace from{' '}
        <Link
          href="/account"
          style={{ color: 'var(--accent)', textDecoration: 'none' }}
        >
          /account
        </Link>
        .
      </p>
    </div>
  )
}

function InboxLink({ unread }: { unread: number }) {
  const hasUnread = unread > 0
  return (
    <Link
      href="/my/inbox"
      className="ts-12 mono inline-flex items-center gap-2"
      style={{
        background: hasUnread ? 'var(--accent-soft)' : 'var(--panel)',
        color: hasUnread ? 'var(--accent)' : 'var(--mute)',
        border: `1px solid ${hasUnread ? 'var(--accent-line)' : 'var(--line)'}`,
        borderRadius: 6,
        padding: '6px 12px',
        textDecoration: 'none',
      }}
    >
      <span>inbox</span>
      {hasUnread && (
        <span
          className="mono"
          style={{
            background: 'var(--accent)',
            color: 'white',
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 999,
            minWidth: 18,
            textAlign: 'center',
          }}
        >
          {unread}
        </span>
      )}
    </Link>
  )
}

function InboxBanner({ unread }: { unread: number }) {
  return (
    <Link
      href="/my/inbox"
      className="block rounded-md px-4 py-3 mb-5"
      style={{
        background: 'var(--accent-soft)',
        border: '1px solid var(--accent-line)',
        textDecoration: 'none',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div
            className="lbl"
            style={{ color: 'var(--accent)', letterSpacing: '0.05em' }}
          >
            § INBOX
          </div>
          <div
            className="ts-13 mt-0.5"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            You have {unread} unread notification
            {unread === 1 ? '' : 's'} — review verdicts, replies, and 打回 messages.
          </div>
        </div>
        <span
          className="ts-13 mono"
          style={{ color: 'var(--accent)' }}
          aria-hidden
        >
          open →
        </span>
      </div>
    </Link>
  )
}

function formatDeadline(d: Date): { label: string; urgency: 'overdue' | 'today' | 'soon' | 'later' } {
  const now = Date.now()
  const ms = d.getTime() - now
  if (ms < 0) return { label: 'overdue', urgency: 'overdue' }
  const days = Math.floor(ms / (24 * 3600 * 1000))
  if (days === 0) return { label: 'closes today', urgency: 'today' }
  if (days <= 2) return { label: `closes in ${days}d`, urgency: 'soon' }
  return { label: `closes in ${days}d`, urgency: 'later' }
}
