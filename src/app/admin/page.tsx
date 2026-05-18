import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import {
  getAdminDashboardData,
  type AdminWorkspaceCard,
  type AdminPendingItem,
} from '@/lib/queries/admin-dashboard'
import { getAdminCostSummary } from '@/lib/queries/admin-costs'
import { CostPanel } from '@/components/admin/cost-panel'

export const metadata: Metadata = {
  title: 'Admin — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /admin — cross-workspace cockpit for users who admin at least one
 * workspace. Three sections:
 *
 *   1. WORKSPACE CARDS — one per workspace the viewer admins, with
 *      pending QC count, last-week approval/rejection numbers, and
 *      a "needs revision" callout.
 *   2. PENDING ACROSS ALL — oldest-first list of annotations awaiting
 *      QC pass or admin acceptance, across every workspace.
 *   3. RECENTLY REJECTED — last 14 days of rejected annotations the
 *      admin might want to revisit (training data for next refinement).
 *
 * Access: must be admin of at least ONE workspace. Anyone else gets
 * a 404 (don't leak the existence of the admin surface).
 */
export default async function AdminDashboardPage() {
  const me = await optionalUser()
  if (!me) redirect('/signin?next=/admin')

  const [data, costs] = await Promise.all([
    getAdminDashboardData({ userId: me.id }),
    getAdminCostSummary({ viewerUserId: me.id }).catch(() => ({
      today: {
        scope: 'today' as const,
        totalCostUsd: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCalls: 0,
        byWorkspace: [],
        byFeature: [],
      },
      last7d: {
        scope: 'last7d' as const,
        totalCostUsd: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCalls: 0,
        byWorkspace: [],
        byFeature: [],
      },
    })),
  ])
  if (data.cards.length === 0) {
    // Not an admin of any workspace — surface 404. The link to /admin
    // is only rendered for admins so they shouldn't hit this normally.
    notFound()
  }

  const totalPending = data.cards.reduce(
    (sum, c) => sum + c.pendingReview,
    0,
  )
  const totalApproved = data.cards.reduce(
    (sum, c) => sum + c.approvedLast7d,
    0,
  )
  const totalRejected = data.cards.reduce(
    (sum, c) => sum + c.rejectedLast7d,
    0,
  )

  return (
    <main
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-6">
          <div className="lbl">§ ADMIN</div>
          <h1
            className="ts-32 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 600 }}
          >
            Workspaces you run
          </h1>
          <p
            className="ts-13 mt-2"
            style={{ color: 'var(--mute)', maxWidth: 600 }}
          >
            Cross-workspace cockpit. The pending queue surfaces the
            oldest unreviewed work first so backlog doesn&apos;t silently
            grow.
          </p>
        </div>

        <section className="mb-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryStat
              label="WORKSPACES"
              value={data.cards.length}
              hint="you administer"
            />
            <SummaryStat
              label="PENDING REVIEW"
              value={totalPending}
              hint="needs QC or accept"
              accent={totalPending > 0 ? 'warn' : 'ok'}
            />
            <SummaryStat
              label="APPROVED · 7D"
              value={totalApproved}
              hint="all workspaces"
              accent="ok"
            />
            <SummaryStat
              label="REJECTED · 7D"
              value={totalRejected}
              hint="all workspaces"
              accent={totalRejected > 0 ? 'bad' : 'ok'}
            />
          </div>
        </section>

        {/* Phase-19: platform-cost rollup across the admin's workspaces. */}
        <CostPanel today={costs.today} last7d={costs.last7d} />

        <section className="mb-10">
          <div className="lbl mb-3">§ WORKSPACE CARDS</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.cards.map((c) => (
              <WorkspaceCard key={c.workspaceId} card={c} />
            ))}
          </div>
          <div className="mt-3 flex items-center">
            <Link
              href="/workspaces/new"
              className="ts-12 mono"
              style={{
                background: 'transparent',
                color: 'var(--accent)',
                border: '1px solid oklch(0.6 0.18 280 / 0.4)',
                borderRadius: 5,
                padding: '4px 12px',
                textDecoration: 'none',
              }}
            >
              + new workspace
            </Link>
          </div>
        </section>

        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-3">
            <div className="lbl">§ PENDING ACROSS ALL WORKSPACES</div>
            <span
              className="ts-11 mono"
              style={{ color: 'var(--mute2)' }}
            >
              {data.pendingAcrossAll.length} item
              {data.pendingAcrossAll.length === 1 ? '' : 's'} · oldest
              first
            </span>
          </div>
          {data.pendingAcrossAll.length === 0 ? (
            <EmptyCard message="No pending review work. The annotators caught up." />
          ) : (
            <PendingList items={data.pendingAcrossAll} />
          )}
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <div className="lbl">§ RECENTLY REJECTED · 14D</div>
            <span
              className="ts-11 mono"
              style={{ color: 'var(--mute2)' }}
            >
              {data.recentlyRejected.length} item
              {data.recentlyRejected.length === 1 ? '' : 's'}
            </span>
          </div>
          {data.recentlyRejected.length === 0 ? (
            <EmptyCard message="No rejections in the last 14 days. Quality looking healthy." />
          ) : (
            <PendingList items={data.recentlyRejected} variant="rejected" />
          )}
        </section>
      </div>
    </main>
  )
}

// ─── Workspace card ──────────────────────────────────────────────────────

function WorkspaceCard({ card }: { card: AdminWorkspaceCard }) {
  const fmt = (d: Date | null) =>
    d ? d.toISOString().slice(0, 10) : 'no activity yet'

  return (
    <Link
      href={`/workspaces/${card.workspaceId}`}
      className="block rounded-md p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        textDecoration: 'none',
      }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3
          className="ts-15 truncate"
          style={{ color: 'var(--hi)', fontWeight: 500 }}
        >
          {card.name}
        </h3>
        <span
          className="mono ts-11 shrink-0 px-2 py-0.5 rounded"
          style={{
            background: 'oklch(0.6 0.18 280 / 0.1)',
            color: 'var(--accent)',
            border: '1px solid oklch(0.6 0.18 280 / 0.25)',
          }}
        >
          {card.templateMode}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 mt-3">
        <Mini label="pending" value={card.pendingReview} accent={card.pendingReview > 0 ? 'warn' : undefined} />
        <Mini label="approved" value={card.approvedLast7d} accent="ok" />
        <Mini label="rejected" value={card.rejectedLast7d} accent={card.rejectedLast7d > 0 ? 'bad' : undefined} />
        <Mini label="打回" value={card.awaitingRevision} accent={card.awaitingRevision > 0 ? 'warn' : undefined} />
      </div>

      <p
        className="ts-11 mono mt-3"
        style={{ color: 'var(--mute2)' }}
      >
        last activity {fmt(card.lastActivityAt)} · open →
      </p>
    </Link>
  )
}

function Mini({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: 'ok' | 'warn' | 'bad'
}) {
  const color =
    accent === 'ok'
      ? 'oklch(0.65 0.18 200)'
      : accent === 'warn'
        ? 'oklch(0.7 0.14 75)'
        : accent === 'bad'
          ? 'var(--danger)'
          : 'var(--text)'
  return (
    <div>
      <div
        className="ts-11 mono"
        style={{ color: 'var(--mute2)' }}
      >
        {label}
      </div>
      <div
        className="ts-18 mono"
        style={{ color, fontWeight: 600 }}
      >
        {value}
      </div>
    </div>
  )
}

// ─── Pending list ────────────────────────────────────────────────────────

function PendingList({
  items,
  variant,
}: {
  items: AdminPendingItem[]
  variant?: 'rejected'
}) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => {
        const url =
          item.templateMode === 'agent-trace-eval'
            ? `/workspaces/${item.workspaceId}/trajectories?annotationId=${item.annotationId}`
            : `/workspaces/${item.workspaceId}/topics/${item.topicId}/annotate?annotationId=${item.annotationId}`
        return (
          <li key={item.annotationId}>
            <Link
              href={url}
              className="block rounded-md p-3"
              style={{
                background: 'var(--panel)',
                border:
                  variant === 'rejected'
                    ? '1px solid oklch(0.55 0.2 25 / 0.3)'
                    : '1px solid var(--line)',
                textDecoration: 'none',
              }}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="ts-12 mono truncate" style={{ color: 'var(--text)' }}>
                  {item.workspaceName} · {item.taskName}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="mono ts-11 px-2 py-0.5 rounded"
                    style={{
                      background: 'oklch(0.6 0.18 280 / 0.1)',
                      color: 'var(--accent)',
                      border: '1px solid oklch(0.6 0.18 280 / 0.25)',
                    }}
                  >
                    {item.templateMode}
                  </span>
                  <StatusPill status={item.topicStatus} />
                </div>
              </div>
              <p
                className="ts-11 mono mt-1"
                style={{ color: 'var(--mute2)' }}
              >
                submitter{' '}
                <span style={{ color: 'var(--hi)' }}>
                  {item.submitterDisplayName ?? 'anon'}
                </span>{' '}
                · {item.submittedAt?.toISOString().slice(0, 10) ?? '—'}
              </p>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function StatusPill({ status }: { status: string }) {
  const palette = STATUS_PALETTE[status] ?? {
    bg: 'var(--panel2)',
    fg: 'var(--mute)',
  }
  return (
    <span
      className="mono ts-11 px-2 py-0.5 rounded"
      style={{
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.fg}33`,
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  )
}

const STATUS_PALETTE: Record<string, { bg: string; fg: string }> = {
  submitted: {
    bg: 'oklch(0.55 0.15 220 / 0.12)',
    fg: 'oklch(0.65 0.15 220)',
  },
  reviewing: {
    bg: 'oklch(0.94 0.04 200 / 0.5)',
    fg: 'oklch(0.45 0.15 200)',
  },
  awaiting_acceptance: {
    bg: 'oklch(0.94 0.04 200 / 0.5)',
    fg: 'oklch(0.45 0.15 200)',
  },
  revising: {
    bg: 'oklch(0.7 0.14 75 / 0.15)',
    fg: 'oklch(0.7 0.14 75)',
  },
  approved: { bg: 'var(--success-soft)', fg: 'var(--success)' },
  rejected: { bg: 'var(--danger-soft)', fg: 'var(--danger)' },
}

// ─── Summary stat tile ───────────────────────────────────────────────────

function SummaryStat({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: number
  hint: string
  accent?: 'ok' | 'warn' | 'bad'
}) {
  const color =
    accent === 'ok'
      ? 'oklch(0.65 0.18 200)'
      : accent === 'warn'
        ? 'oklch(0.7 0.14 75)'
        : accent === 'bad'
          ? 'var(--danger)'
          : 'var(--text)'
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
        {label}
      </div>
      <div className="ts-22 mono" style={{ color, fontWeight: 600 }}>
        {value}
      </div>
      <div className="ts-11 mono mt-0.5" style={{ color: 'var(--mute2)' }}>
        {hint}
      </div>
    </div>
  )
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div
      className="rounded-md p-4 text-center ts-13"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line)',
        color: 'var(--mute2)',
      }}
    >
      {message}
    </div>
  )
}
