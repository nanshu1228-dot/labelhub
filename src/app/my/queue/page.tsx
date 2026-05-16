import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import {
  listMyQueueForUser,
  getMyQueueStats,
} from '@/lib/queries/annotator-queue'
import { listMyAnnotatableWorkspaces } from '@/lib/actions/queue'
import {
  listMyTopicQueueForUser,
  type TopicQueueItem,
} from '@/lib/queries/topic-queue'
import { countUnreadNotifications } from '@/lib/queries/notifications'

export const metadata: Metadata = {
  title: 'My Queue — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /my/queue — annotator's daily landing page.
 *
 * SSR loads the three pieces the UI needs:
 *   - the workspace selector (workspaces I can annotate in)
 *   - the ranked queue items (filtered by selected workspace, if any)
 *   - my today/all-time contribution stats
 *
 * Server-only auth gate; renders for any signed-in user (the queue itself
 * will be empty if they're not in any annotatable workspace).
 *
 * **UI status**: this page is currently a structured placeholder. The
 * styled version comes from the Claude Design output and replaces the
 * <QueueClient> stub below. The query layer + filter logic + Server
 * Actions are all wired and ready.
 */
export default async function MyQueuePage(props: {
  searchParams?: Promise<{ workspaceId?: string }>
}) {
  const search = (await props.searchParams) ?? {}
  const workspaceFilter =
    typeof search.workspaceId === 'string' ? search.workspaceId : undefined

  const me = await optionalUser()
  if (!me) redirect('/signin?next=/my/queue')

  const [workspaces, queue, stats, topicQueue, unreadCount] = await Promise.all([
    listMyAnnotatableWorkspaces({ userId: me.id }),
    listMyQueueForUser({
      userId: me.id,
      workspaceId: workspaceFilter,
      limit: 50,
    }),
    getMyQueueStats({
      userId: me.id,
      workspaceId: workspaceFilter,
    }),
    listMyTopicQueueForUser({
      userId: me.id,
      workspaceId: workspaceFilter,
      limit: 50,
    }),
    countUnreadNotifications(me.id).catch(() => 0),
  ])

  return (
    <main className="app-light min-h-screen px-6 py-8" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto max-w-[960px]">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="lbl mb-2">§ FLAT QUEUE</div>
            <h1 className="ts-32" style={{ color: 'var(--hi)' }}>
              All topics across every task
            </h1>
            <p
              className="ts-13 mt-1"
              style={{ color: 'var(--mute)', maxWidth: 640 }}
            >
              Power-user view — every claimable topic across every
              workspace, mixed together. Most labelers use{' '}
              <Link
                href="/my/tasks"
                style={{ color: 'var(--accent)', textDecoration: 'none' }}
              >
                /my/tasks
              </Link>{' '}
              to pick a campaign first, then drill in. This view is
              here when you want to browse without picking a task.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <InboxLink unread={unreadCount} />
            <Link
              href="/my/tasks"
              className="ts-12 mono"
              style={{
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                border: '1px solid var(--accent-line)',
                borderRadius: 6,
                padding: '6px 12px',
                textDecoration: 'none',
              }}
            >
              ← my tasks
            </Link>
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
          </div>
        </div>

        {unreadCount > 0 && <InboxBanner unread={unreadCount} />}

        <StatsRow stats={stats} />

        <WorkspaceFilter
          workspaces={workspaces}
          activeWorkspaceId={workspaceFilter ?? null}
        />

        {topicQueue.length > 0 && (
          <section className="mb-6">
            <div className="lbl mb-2">§ TOPICS · PAIR-RUBRIC / ARENA-GSB</div>
            <TopicQueueList items={topicQueue} />
          </section>
        )}

        <section>
          {topicQueue.length > 0 && (
            <div className="lbl mb-2">§ TRAJECTORIES</div>
          )}
          <QueueList items={queue} />
        </section>
      </div>
    </main>
  )
}

/**
 * Header-strip link to /my/inbox with an unread badge. Renders even
 * when unread=0 so the inbox is always discoverable from the queue
 * page; the badge just hides when empty.
 */
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

/**
 * Full-width attention banner — only renders when unread > 0. The
 * idea: a busy annotator scrolling to the queue should see a clear
 * "go check your inbox" callout before they start picking new work,
 * so they don't miss a 打回 from their last session.
 */
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
            You have {unread} unread notification{unread === 1 ? '' : 's'} —
            review verdicts, replies, and 打回 messages.
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

function TopicQueueList({ items }: { items: TopicQueueItem[] }) {
  return (
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
        return (
          <li key={item.topicId}>
            <Link
              href={`/workspaces/${item.workspaceId}/topics/${item.topicId}/annotate`}
              className="block rounded-xl p-4"
              style={{
                background: 'var(--panel)',
                border: `1px solid ${accent}`,
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
                status {item.topicStatus} · {item.createdAt.toISOString().slice(0, 10)}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
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
    3: { bg: 'oklch(0.55 0 0 / 0.14)', fg: 'oklch(0.45 0 0)', label: 'standard' },
    4: { bg: 'oklch(0.7 0.14 75 / 0.15)', fg: 'oklch(0.55 0.14 75)', label: 'hard' },
    5: { bg: 'oklch(0.55 0.2 25 / 0.15)', fg: 'var(--danger)', label: 'expert' },
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
      <span aria-hidden>🔥</span>
      <span>
        {p.label} · {difficulty}/5
      </span>
    </span>
  )
}

// ─── Placeholder UI — replace with Claude Design output ──────────────────

function StatsRow({
  stats,
}: {
  stats: Awaited<ReturnType<typeof getMyQueueStats>>
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <Stat label="done today" value={stats.doneToday} accent />
      <Stat label="in progress" value={stats.inProgress} />
      <Stat label="all-time" value={stats.doneAllTime} />
      <Stat
        label="disputes broken"
        value={stats.disputesBrokenToday}
        hint="today"
      />
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
  hint,
}: {
  label: string
  value: number
  accent?: boolean
  hint?: string
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="lbl mb-1" style={{ color: 'var(--mute2)' }}>
        {label}
      </div>
      <div
        className="ts-24 mono"
        style={{
          color: accent && value > 0 ? 'var(--accent)' : 'var(--hi)',
          fontWeight: 600,
        }}
      >
        {value}
      </div>
      {hint && (
        <div className="ts-11 mt-0.5" style={{ color: 'var(--mute2)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}

function WorkspaceFilter({
  workspaces,
  activeWorkspaceId,
}: {
  workspaces: Awaited<ReturnType<typeof listMyAnnotatableWorkspaces>>
  activeWorkspaceId: string | null
}) {
  if (workspaces.length <= 1) return null
  return (
    <div className="flex items-center gap-2 flex-wrap mb-6">
      <span className="lbl" style={{ color: 'var(--mute2)' }}>
        workspaces:
      </span>
      <Link
        href="/my/queue"
        className="mono"
        style={{
          background:
            activeWorkspaceId === null ? 'var(--accent)' : 'var(--panel2)',
          color: activeWorkspaceId === null ? 'white' : 'var(--text)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          padding: '2px 10px',
          fontSize: 11,
          textDecoration: 'none',
        }}
      >
        all
      </Link>
      {workspaces.map((w) => (
        <Link
          key={w.workspaceId}
          href={`/my/queue?workspaceId=${w.workspaceId}`}
          className="mono trunc-1"
          style={{
            background:
              activeWorkspaceId === w.workspaceId
                ? 'var(--accent)'
                : 'var(--panel2)',
            color:
              activeWorkspaceId === w.workspaceId ? 'white' : 'var(--text)',
            border: '1px solid var(--line)',
            borderRadius: 4,
            padding: '2px 10px',
            fontSize: 11,
            textDecoration: 'none',
            maxWidth: 180,
          }}
        >
          {w.workspaceName}
        </Link>
      ))}
    </div>
  )
}

function QueueList({
  items,
}: {
  items: Awaited<ReturnType<typeof listMyQueueForUser>>
}) {
  if (items.length === 0) {
    return (
      <div
        className="rounded-xl p-6 text-center"
        style={{
          background: 'var(--panel)',
          border: '1px dashed var(--line2)',
        }}
      >
        <h3 className="ts-16" style={{ color: 'var(--hi)', fontWeight: 500 }}>
          No trajectories
        </h3>
        <p
          className="ts-13 mt-2 mx-auto"
          style={{ color: 'var(--mute)', maxWidth: 420 }}
        >
          Nothing from agent-trace-eval workspaces awaiting your annotation.
          If you&apos;re in a pair-rubric or arena-gsb workspace, topics show
          up in the section above instead. Otherwise — refresh after a new
          capture lands.
        </p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.trajectoryId}>
          <Link
            href={`/workspaces/${item.workspaceId}/trajectories/${item.trajectoryId}/annotate`}
            className="block rounded-xl p-4"
            style={{
              background: 'var(--panel)',
              border: `1px solid ${
                item.priority === 'dispute'
                  ? 'oklch(0.55 0.2 25 / 0.4)'
                  : item.priority === 'resume'
                    ? 'oklch(0.7 0.14 75 / 0.4)'
                    : 'var(--line)'
              }`,
              textDecoration: 'none',
              transition: 'border-color 120ms',
            }}
          >
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <PriorityBadge
                  priority={item.priority}
                  disputeCount={item.disputeCount}
                />
                <span
                  className="mono ts-12"
                  style={{ color: 'var(--hi)' }}
                >
                  {item.agentName}
                </span>
                <span
                  className="mono ts-11"
                  style={{ color: 'var(--mute2)' }}
                >
                  {item.workspaceName} · {item.stepCount} steps
                </span>
              </div>
              <span
                className="ts-12 mono"
                style={{ color: 'var(--accent)' }}
              >
                start →
              </span>
            </div>
            <p
              className="ts-13"
              style={{ color: 'var(--text)', lineHeight: 1.5 }}
            >
              {item.summaryPreview || item.rootPromptPreview}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function PriorityBadge({
  priority,
  disputeCount,
}: {
  priority: 'dispute' | 'resume' | 'peer' | 'fresh'
  disputeCount: number
}) {
  const palette = {
    dispute: {
      bg: 'var(--danger-soft)',
      fg: 'var(--danger)',
      bord: 'oklch(0.55 0.2 25 / 0.4)',
      label:
        disputeCount === 1
          ? '⚡ 1 dispute'
          : `⚡ ${disputeCount} disputes`,
    },
    resume: {
      bg: 'oklch(0.7 0.14 75 / 0.08)',
      fg: 'var(--warn)',
      bord: 'oklch(0.7 0.14 75 / 0.4)',
      label: '↻ resume',
    },
    peer: {
      bg: 'var(--accent-soft)',
      fg: 'var(--accent)',
      bord: 'var(--accent-line)',
      label: 'peer-rated',
    },
    fresh: {
      bg: 'var(--panel2)',
      fg: 'var(--mute)',
      bord: 'var(--line)',
      label: 'fresh',
    },
  }
  const p = palette[priority]
  return (
    <span
      className="mono shrink-0"
      style={{
        background: p.bg,
        color: p.fg,
        border: `1px solid ${p.bord}`,
        borderRadius: 4,
        padding: '1px 8px',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {p.label}
    </span>
  )
}
