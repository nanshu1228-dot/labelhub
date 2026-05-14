import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events, users } from '@/lib/db/schema'
import { optionalUser, requireWorkspaceMember } from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'

export const metadata: Metadata = {
  title: 'Activity — LabelHub',
}

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 200

/**
 * /workspaces/[id]/activity
 *
 * Audit log surface. Renders the workspace's recent events as a chronological
 * stream — who did what, when. Every mutation in the system writes an event
 * row (Pillar 2: event sourcing) so this is the canonical "what's happened
 * lately" view for admins.
 *
 * Member-readable (any role can browse), unauth bounce to /signin. We display
 * actor email when known, fall back to "system" for null actorIds (background
 * jobs, AI hint generation, etc.).
 *
 * No write actions here — events are append-only by design.
 */
export default async function ActivityPage(
  props: PageProps<'/workspaces/[id]/activity'>,
) {
  const { id: workspaceId } = await props.params

  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${workspaceId}/activity`)

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  // Membership gate — viewers can browse activity (read-only by definition).
  await requireWorkspaceMember(workspaceId)

  const db = getDb()
  const rows = await db
    .select({
      id: events.id,
      type: events.type,
      actorId: events.actorId,
      payload: events.payload,
      ts: events.ts,
      actorEmail: users.email,
      actorDisplayName: users.displayName,
    })
    .from(events)
    .leftJoin(users, eq(users.id, events.actorId))
    .where(eq(events.workspaceId, workspaceId))
    .orderBy(desc(events.ts))
    .limit(PAGE_SIZE)

  return (
    <div className="app-light min-h-screen" style={{ background: 'var(--bg)' }}>
      <header
        className="hairline-b sticky top-0 z-10"
        style={{ background: 'var(--panel)' }}
      >
        <div className="mx-auto max-w-[1200px] flex items-center justify-between px-6 py-3">
          <nav
            className="ts-12 mono flex items-center gap-1.5 min-w-0"
            style={{ color: 'var(--mute2)' }}
          >
            <Link
              href={`/workspaces/${workspaceId}`}
              className="truncate-1 hover:underline"
              style={{ color: 'var(--text)', maxWidth: 200 }}
            >
              {workspace.name}
            </Link>
            <span>/</span>
            <span style={{ color: 'var(--hi)' }}>activity</span>
          </nav>
          <Link href="/" className="ts-13 mono" style={{ color: 'var(--hi)' }}>
            <span style={{ color: 'var(--accent)' }}>§</span> labelhub
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1000px] px-6 py-8">
        <div className="mb-6">
          <div className="lbl mb-2">§ ACTIVITY</div>
          <h1 className="ts-32" style={{ color: 'var(--hi)' }}>
            What&apos;s happened lately
          </h1>
          <p className="ts-13 mt-1" style={{ color: 'var(--mute)' }}>
            Append-only audit log. {PAGE_SIZE.toLocaleString()} most recent
            events. Every mutation writes one row — annotations, comparisons,
            billing, member changes, AI hint computes, settings edits.
          </p>
        </div>

        {rows.length === 0 ? (
          <div
            className="rounded-xl p-6 text-center"
            style={{
              background: 'var(--panel)',
              border: '1px dashed var(--line2)',
            }}
          >
            <h3 className="ts-16" style={{ color: 'var(--hi)', fontWeight: 500 }}>
              No activity yet
            </h3>
            <p
              className="ts-13 mt-2 mx-auto"
              style={{ color: 'var(--mute)', maxWidth: 380 }}
            >
              Capture a trajectory, mark a step, or close a billing period —
              all of those land here.
            </p>
          </div>
        ) : (
          <ol
            className="rounded-xl overflow-hidden"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            {rows.map((r, idx) => (
              <li
                key={r.id}
                className="flex items-start gap-4 px-4 py-3"
                style={{
                  borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                }}
              >
                <div
                  className="mono ts-11 shrink-0"
                  style={{ color: 'var(--mute2)', width: 130 }}
                  title={r.ts.toISOString()}
                >
                  {r.ts.toISOString().slice(0, 16).replace('T', ' ')}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <EventTypeBadge type={r.type} />
                    <span className="ts-12" style={{ color: 'var(--mute)' }}>
                      by
                    </span>
                    <span
                      className="ts-12 mono trunc-1"
                      style={{ color: 'var(--hi)', maxWidth: 240 }}
                    >
                      {r.actorEmail
                        ? (r.actorDisplayName ?? r.actorEmail)
                        : 'system'}
                    </span>
                  </div>
                  <PayloadPreview type={r.type} payload={r.payload} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function EventTypeBadge({ type }: { type: string }) {
  // Color-code by family so the stream is scannable.
  const family = type.split('.')[0]
  const palette: Record<string, { bg: string; fg: string }> = {
    workspace: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
    member: { bg: 'oklch(0.94 0.04 200)', fg: 'oklch(0.45 0.15 200)' },
    invite: { bg: 'oklch(0.94 0.04 200)', fg: 'oklch(0.45 0.15 200)' },
    payout: { bg: 'oklch(0.94 0.04 145)', fg: 'oklch(0.42 0.13 145)' },
    payout_period: { bg: 'oklch(0.94 0.04 145)', fg: 'oklch(0.42 0.13 145)' },
    payout_line_item: { bg: 'oklch(0.94 0.04 145)', fg: 'oklch(0.42 0.13 145)' },
    wallet: { bg: 'oklch(0.94 0.04 145)', fg: 'oklch(0.42 0.13 145)' },
    annotation: { bg: 'oklch(0.94 0 0)', fg: 'var(--hi)' },
    step_mark: { bg: 'oklch(0.94 0 0)', fg: 'var(--hi)' },
    trajectory_mark: { bg: 'oklch(0.94 0 0)', fg: 'var(--hi)' },
    trajectory_hints: { bg: 'oklch(0.94 0.04 280)', fg: 'oklch(0.45 0.15 280)' },
    comparison: { bg: 'oklch(0.94 0.04 280)', fg: 'oklch(0.45 0.15 280)' },
    connection: { bg: 'oklch(0.94 0.04 60)', fg: 'oklch(0.45 0.15 60)' },
  }
  const v = palette[family] ?? { bg: 'var(--panel2)', fg: 'var(--mute)' }
  return (
    <span
      className="mono ts-11 shrink-0"
      style={{
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.fg}33`,
        padding: '2px 8px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
      }}
    >
      {type}
    </span>
  )
}

function PayloadPreview({
  type,
  payload,
}: {
  type: string
  payload: unknown
}) {
  // Render a one-line natural-language preview for the most common event
  // types. Falls back to a compact JSON snippet for unknown types so
  // nothing important is hidden.
  const p = (payload ?? {}) as Record<string, unknown>

  const text = describeEvent(type, p)
  if (text) {
    return (
      <div className="ts-12 mt-0.5" style={{ color: 'var(--text)' }}>
        {text}
      </div>
    )
  }

  return (
    <details className="mt-0.5">
      <summary
        className="ts-11 mono cursor-pointer"
        style={{ color: 'var(--mute2)' }}
      >
        payload
      </summary>
      <pre
        className="mono ts-11 mt-1 p-2 rounded-md overflow-x-auto"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          color: 'var(--text)',
        }}
      >
        {JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  )
}

function describeEvent(
  type: string,
  p: Record<string, unknown>,
): string | null {
  switch (type) {
    case 'workspace.created':
      return `Created workspace "${strOrDash(p.name)}" (mode: ${strOrDash(p.templateMode)})`
    case 'workspace.renamed':
      return `Renamed workspace: "${strOrDash(p.previousName)}" → "${strOrDash(p.newName)}"`
    case 'member.role_changed':
      return `Role changed on member: ${strOrDash(p.previousRole)} → ${strOrDash(p.newRole)}`
    case 'member.removed':
      return `Removed member ${strOrDash(p.userId).slice(0, 8)}…`
    case 'invite.created':
      return `Invited ${strOrDash(p.email)} as ${strOrDash(p.role)}`
    case 'invite.accepted':
      return `Invite accepted by ${strOrDash(p.email)}`
    case 'invite.revoked':
      return `Revoked invite for ${strOrDash(p.email)}`
    case 'payout_line_item.created':
    case 'payout_line_item.updated':
      return `Approved annotation → ${(numOrZero(p.totalAmountMinor) / 100).toFixed(2)} ${strOrDash(p.currency)}`
    case 'payout_period.closed':
      return `Closed payout period: ${numOrZero(p.payoutCount)} payouts, ${(numOrZero(p.grandTotalMinor) / 100).toFixed(2)} grand total`
    case 'payout.paid':
      return `Marked payout paid: ${(numOrZero(p.amountMinor) / 100).toFixed(2)} ${strOrDash(p.currency)}`
    case 'wallet.withdraw_requested':
      return `Withdraw requested: ${(numOrZero(p.amountMinor) / 100).toFixed(2)} ${strOrDash(p.currency)} via ${strOrDash(p.paymentMethodType)}`
    case 'step_mark.created':
    case 'step_mark.updated':
      return `Marked rubric "${strOrDash(p.rubricId)}" on a trajectory step`
    case 'trajectory_mark.updated':
      return `Marked rubric "${strOrDash(p.rubricId)}" on a trajectory`
    case 'comparison.submitted': {
      const dims = p.winners && typeof p.winners === 'object'
        ? Object.keys(p.winners as object).length
        : 0
      return `Submitted comparison across ${dims} dimension${dims === 1 ? '' : 's'}`
    }
    case 'trajectory_hints.computed':
      return `Computed AI hints for trajectory (${numOrZero(p.hintCount)} hints, ${numOrZero(p.stepCount)} steps, ${strOrDash(p.model)})`
    case 'connection.created':
      return `Added LLM connection: ${strOrDash(p.displayName)} (${strOrDash(p.providerKind)})`
    case 'connection.enabled':
      return `Re-enabled LLM connection`
    case 'connection.disabled':
      return `Disabled LLM connection`
    case 'connection.deleted':
      return `Deleted LLM connection`
    default:
      return null
  }
}

function strOrDash(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return '—'
}

function numOrZero(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}
