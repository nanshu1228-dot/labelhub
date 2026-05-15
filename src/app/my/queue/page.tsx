import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import {
  listMyQueueForUser,
  getMyQueueStats,
} from '@/lib/queries/annotator-queue'
import { listMyAnnotatableWorkspaces } from '@/lib/actions/queue'

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

  const [workspaces, queue, stats] = await Promise.all([
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
  ])

  return (
    <main className="app-light min-h-screen px-6 py-8" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto max-w-[960px]">
        <div className="mb-6">
          <div className="lbl mb-2">§ MY QUEUE</div>
          <h1 className="ts-32" style={{ color: 'var(--hi)' }}>
            What&apos;s next
          </h1>
          <p
            className="ts-13 mt-1"
            style={{ color: 'var(--mute)', maxWidth: 640 }}
          >
            Ranked by where your mark will move the needle most — open
            disputes first, then your drafts, then peer-rated, then fresh
            captures.
          </p>
        </div>

        <StatsRow stats={stats} />

        <WorkspaceFilter
          workspaces={workspaces}
          activeWorkspaceId={workspaceFilter ?? null}
        />

        <QueueList items={queue} />
      </div>
    </main>
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
          You&apos;re all caught up
        </h3>
        <p
          className="ts-13 mt-2 mx-auto"
          style={{ color: 'var(--mute)', maxWidth: 380 }}
        >
          No trajectories awaiting your annotation. New captures will land
          here automatically — refresh in a few minutes.
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
