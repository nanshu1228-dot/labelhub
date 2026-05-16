import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import {
  listMyAllSubmissions,
  type MySubmissionRow,
} from '@/lib/queries/annotations'

export const metadata: Metadata = {
  title: 'My submissions — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /my/submissions — the annotator's work history.
 *
 * Cross-mode: lists every annotation the user has submitted (or drafted)
 * across every workspace they belong to. Status badge tells the story:
 * submitted / reviewing / awaiting_acceptance / approved / rejected /
 * revising. Each row links back to its annotate URL (with annotationId
 * if the row is past drafting so the user reads their own work in
 * review mode).
 *
 * Distinct from /my/earnings (which is about payout amounts) and
 * /my/queue (which is the FORWARD-looking work feed). This page is the
 * BACKWARD-looking history.
 */
export default async function MySubmissionsPage(props: {
  searchParams?: Promise<{ status?: string }>
}) {
  const search = (await props.searchParams) ?? {}
  const filter = typeof search.status === 'string' ? search.status : 'all'

  const me = await optionalUser()
  if (!me) redirect('/signin?next=/my/submissions')

  const all = await listMyAllSubmissions({ userId: me.id, limit: 200 })

  // Bucket counts for the filter chips.
  const counts = bucketCounts(all)
  const visible = applyFilter(all, filter)

  return (
    <main
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <div className="mx-auto max-w-[1000px]">
        <div className="mb-6">
          <div className="lbl mb-2">§ MY SUBMISSIONS</div>
          <h1 className="ts-28" style={{ color: 'var(--hi)' }}>
            Work history
          </h1>
          <p
            className="ts-13 mt-1"
            style={{ color: 'var(--mute)', maxWidth: 580 }}
          >
            Every annotation you&apos;ve submitted, plus drafts still in
            flight. Click a row to open it (read-only once past drafting).
          </p>
        </div>

        <FilterChips active={filter} counts={counts} />

        {visible.length === 0 ? (
          <EmptyCard filter={filter} />
        ) : (
          <ul className="flex flex-col gap-2 mt-4">
            {visible.map((r) => (
              <SubmissionRow key={r.annotationId} row={r} />
            ))}
          </ul>
        )}

        <div className="mt-8 ts-12 mono" style={{ color: 'var(--mute2)' }}>
          showing {visible.length} of {all.length} total · oldest first beyond
          the most-recent 200 are hidden — fetch more by narrowing the filter
        </div>
      </div>
    </main>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function bucketCounts(rows: MySubmissionRow[]) {
  const c = {
    all: rows.length,
    drafting: 0,
    submitted: 0,
    reviewing: 0,
    awaiting_acceptance: 0,
    approved: 0,
    rejected: 0,
    revising: 0,
  }
  for (const r of rows) {
    if (r.topicStatus in c) {
      ;(c as Record<string, number>)[r.topicStatus] += 1
    }
  }
  return c
}

function applyFilter(rows: MySubmissionRow[], filter: string): MySubmissionRow[] {
  if (filter === 'all') return rows
  if (filter === 'in-flight') {
    return rows.filter(
      (r) =>
        r.topicStatus === 'drafting' ||
        r.topicStatus === 'submitted' ||
        r.topicStatus === 'reviewing' ||
        r.topicStatus === 'awaiting_acceptance' ||
        r.topicStatus === 'revising',
    )
  }
  if (filter === 'done') {
    return rows.filter(
      (r) => r.topicStatus === 'approved' || r.topicStatus === 'rejected',
    )
  }
  return rows.filter((r) => r.topicStatus === filter)
}

// ─── Filter chips ────────────────────────────────────────────────────────

function FilterChips({
  active,
  counts,
}: {
  active: string
  counts: ReturnType<typeof bucketCounts>
}) {
  const chips: Array<{ key: string; label: string; count: number }> = [
    { key: 'all', label: 'all', count: counts.all },
    {
      key: 'in-flight',
      label: 'in flight',
      count:
        counts.drafting +
        counts.submitted +
        counts.reviewing +
        counts.awaiting_acceptance +
        counts.revising,
    },
    { key: 'approved', label: 'approved', count: counts.approved },
    { key: 'rejected', label: 'rejected', count: counts.rejected },
    { key: 'revising', label: '打回 (revising)', count: counts.revising },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => {
        const isActive = active === c.key
        return (
          <Link
            key={c.key}
            href={
              c.key === 'all'
                ? '/my/submissions'
                : `/my/submissions?status=${c.key}`
            }
            className="ts-12 mono"
            style={{
              background: isActive
                ? 'oklch(0.6 0.18 280 / 0.12)'
                : 'var(--panel)',
              color: isActive ? 'var(--accent)' : 'var(--mute)',
              border: `1px solid ${isActive ? 'var(--accent)' : 'var(--line)'}`,
              borderRadius: 6,
              padding: '4px 10px',
              textDecoration: 'none',
            }}
          >
            {c.label}
            <span
              className="ml-1.5"
              style={{
                color: isActive ? 'var(--accent)' : 'var(--mute2)',
                opacity: 0.85,
              }}
            >
              {c.count}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

// ─── Row ─────────────────────────────────────────────────────────────────

function SubmissionRow({ row }: { row: MySubmissionRow }) {
  // Build the annotate URL — pair/arena topics and trajectory live at
  // different roots, and review mode wants ?annotationId= when the row
  // is past drafting.
  const isTrajectory = row.templateMode === 'agent-trace-eval'
  const annotateUrl = isTrajectory
    ? // We don't know the trajectoryId from here without a join — link
      // to the trajectories list and let the user find it. Cheap.
      `/workspaces/${row.workspaceId}/trajectories`
    : `/workspaces/${row.workspaceId}/topics/${row.topicId}/annotate${
        row.topicStatus !== 'drafting'
          ? `?annotationId=${row.annotationId}`
          : ''
      }`

  const fmtTs = (d: Date | null) =>
    d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—'

  return (
    <li>
      <Link
        href={annotateUrl}
        className="block rounded-md p-3"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          textDecoration: 'none',
          transition: 'border-color 120ms',
        }}
      >
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <div className="ts-12 mono truncate" style={{ color: 'var(--mute2)' }}>
            {row.workspaceName} · {row.taskName}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ModeChip mode={row.templateMode} />
            <StatusChip status={row.topicStatus} />
          </div>
        </div>
        <p
          className="ts-12 mono truncate"
          style={{ color: 'var(--text)', maxWidth: '100%' }}
          title={row.payloadPreview}
        >
          {row.payloadPreview || '(empty draft)'}
        </p>
        <div
          className="ts-11 mono mt-1"
          style={{ color: 'var(--mute2)' }}
        >
          submitted {fmtTs(row.submittedAt)} · annotation{' '}
          {row.annotationId.slice(0, 8)}
        </div>
      </Link>
    </li>
  )
}

// ─── Status / mode chips ─────────────────────────────────────────────────

const STATUS_STYLES: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  drafting: { bg: 'var(--panel2)', fg: 'var(--mute)', label: 'drafting' },
  submitted: {
    bg: 'oklch(0.55 0.15 220 / 0.12)',
    fg: 'oklch(0.65 0.15 220)',
    label: 'submitted',
  },
  reviewing: {
    bg: 'oklch(0.94 0.04 200 / 0.5)',
    fg: 'oklch(0.45 0.15 200)',
    label: 'reviewing',
  },
  awaiting_acceptance: {
    bg: 'oklch(0.94 0.04 200 / 0.5)',
    fg: 'oklch(0.45 0.15 200)',
    label: 'awaiting acceptance',
  },
  revising: {
    bg: 'oklch(0.7 0.14 75 / 0.15)',
    fg: 'oklch(0.7 0.14 75)',
    label: '打回',
  },
  approved: {
    bg: 'var(--success-soft)',
    fg: 'var(--success)',
    label: 'approved',
  },
  rejected: {
    bg: 'var(--danger-soft)',
    fg: 'var(--danger)',
    label: 'rejected',
  },
}

function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? {
    bg: 'var(--panel2)',
    fg: 'var(--mute)',
    label: status,
  }
  return (
    <span
      className="mono ts-11"
      style={{
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.fg}33`,
        borderRadius: 4,
        padding: '1px 8px',
        fontWeight: 600,
      }}
    >
      {s.label}
    </span>
  )
}

function ModeChip({ mode }: { mode: string }) {
  return (
    <span
      className="mono ts-11"
      style={{
        background: 'oklch(0.6 0.18 280 / 0.1)',
        color: 'var(--accent)',
        border: '1px solid oklch(0.6 0.18 280 / 0.25)',
        borderRadius: 4,
        padding: '1px 8px',
      }}
    >
      {mode.replace(/-/g, ' ')}
    </span>
  )
}

// ─── Empty ───────────────────────────────────────────────────────────────

function EmptyCard({ filter }: { filter: string }) {
  const msg =
    filter === 'approved'
      ? 'No annotations approved yet.'
      : filter === 'rejected'
        ? 'Nothing rejected — clean record so far.'
        : filter === 'revising'
          ? "No 打回 — no one's asked you to revise."
          : filter === 'in-flight'
            ? 'No work in flight. Head to /my/queue to claim something.'
            : "You haven't submitted any annotations yet. Open /my/queue to start."
  return (
    <div
      className="rounded-md p-6 mt-4 text-center"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line)',
      }}
    >
      <p className="ts-13" style={{ color: 'var(--mute)' }}>
        {msg}
      </p>
      <Link
        href="/my/queue"
        className="ts-13 mono inline-block mt-3"
        style={{
          background: 'transparent',
          color: 'var(--accent)',
          border: '1px solid oklch(0.6 0.18 280 / 0.4)',
          borderRadius: 5,
          padding: '4px 12px',
          textDecoration: 'none',
        }}
      >
        open queue →
      </Link>
    </div>
  )
}
