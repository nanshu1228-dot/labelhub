import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { optionalUser, requireWorkspaceAdmin } from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import {
  AUDIT_EVENT_GROUPS,
  searchAuditLog,
  type AuditGroup,
  type AuditRow,
} from '@/lib/queries/audit-log'

export const metadata: Metadata = {
  title: 'Audit log — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/audit — workspace-level audit search.
 *
 * Surfaces every actionable event with filters that match how an
 * admin actually investigates:
 *   - "show me all rejections / revisions / restores related to Alice"
 *   - "what did Bob (admin) do this week"
 *   - "any trust status changes in the last 30 days"
 *
 * Search params:
 *   ?q=alice       → fuzzy match on display_name + email
 *   ?user=<uuid>   → exact subject filter (used by drilldown links)
 *   ?group=verdict|restore|trust|inbox|judge|consensus|invite
 *
 * Multiple groups can stack via repeated query params, but for v1 we
 * keep it single-select since one tab usually answers one question.
 */
export default async function AuditPage(props: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{
    q?: string
    user?: string
    group?: string
  }>
}) {
  const { id: workspaceId } = await props.params
  const search = (await props.searchParams) ?? {}

  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${workspaceId}/audit`)
  try {
    await requireWorkspaceAdmin(workspaceId)
  } catch {
    notFound()
  }
  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  const q = typeof search.q === 'string' ? search.q.trim() : ''
  const subjectUserId =
    typeof search.user === 'string' && search.user.length === 36
      ? search.user
      : undefined
  const groupParam =
    search.group && search.group in AUDIT_EVENT_GROUPS
      ? (search.group as AuditGroup)
      : null
  const types = groupParam
    ? (AUDIT_EVENT_GROUPS[groupParam] as readonly string[])
    : undefined

  const rows = await searchAuditLog({
    workspaceId,
    subjectUserId,
    userQuery: q.length > 0 ? q : undefined,
    types,
    limit: 200,
  })

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
            href={`/workspaces/${workspaceId}`}
            className="hover:underline"
            style={{ color: 'var(--mute)' }}
          >
            {workspace.name}
          </Link>
          <span>·</span>
          <span style={{ color: 'var(--text)' }}>audit</span>
        </nav>

        <div className="mb-6">
          <div className="lbl mb-2">§ AUDIT LOG</div>
          <h1 className="ts-28" style={{ color: 'var(--hi)' }}>
            What happened around whom
          </h1>
          <p
            className="ts-13 mt-2"
            style={{ color: 'var(--mute)', maxWidth: 640 }}
          >
            Every actionable event in this workspace —{' '}
            <strong>verdicts</strong> (approved / rejected / revised /
            qc-passed), <strong>restores</strong> + replies,{' '}
            <strong>trust</strong> lifecycle, etc. Search by rater
            name/email or drill in from anywhere there&apos;s a name.
          </p>
        </div>

        {/* Search form (uses GET so URL is shareable). */}
        <form
          method="get"
          className="flex items-center gap-2 mb-3 flex-wrap"
        >
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="search by name or email…"
            className="ts-13 mono px-3 py-1.5 rounded-md"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
              outline: 'none',
              flex: '1 1 240px',
              maxWidth: 360,
            }}
          />
          {subjectUserId && (
            <input type="hidden" name="user" value={subjectUserId} />
          )}
          {groupParam && (
            <input type="hidden" name="group" value={groupParam} />
          )}
          <button
            type="submit"
            className="ts-13 mono"
            style={{
              background: 'var(--accent)',
              color: 'white',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              padding: '6px 14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            search
          </button>
          {(q || subjectUserId || groupParam) && (
            <Link
              href={`/workspaces/${workspaceId}/audit`}
              className="ts-12 mono"
              style={{
                color: 'var(--mute)',
                textDecoration: 'none',
                padding: '6px 10px',
              }}
            >
              clear
            </Link>
          )}
        </form>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <FilterChip
            active={groupParam === null}
            href={buildHref(workspaceId, { q, user: subjectUserId })}
            label="all"
          />
          {(Object.keys(AUDIT_EVENT_GROUPS) as AuditGroup[]).map((g) => (
            <FilterChip
              key={g}
              active={groupParam === g}
              href={buildHref(workspaceId, {
                q,
                user: subjectUserId,
                group: g,
              })}
              label={GROUP_LABEL[g]}
            />
          ))}
        </div>

        {subjectUserId && (
          <div
            className="ts-12 mono mb-3 p-2 rounded"
            style={{
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-line)',
              color: 'var(--accent)',
            }}
          >
            Filtered to user{' '}
            <span className="mono" style={{ color: 'var(--hi)' }}>
              {subjectUserId.slice(0, 8)}
            </span>{' '}
            ·{' '}
            <Link
              href={`/workspaces/${workspaceId}/audit${q ? `?q=${encodeURIComponent(q)}` : ''}`}
              style={{ color: 'var(--accent)' }}
            >
              remove
            </Link>
          </div>
        )}

        {rows.length === 0 ? (
          <div
            className="rounded-md p-6 text-center ts-13 mono"
            style={{
              background: 'var(--panel)',
              border: '1px dashed var(--line)',
              color: 'var(--mute)',
            }}
          >
            No events match this filter in the last 90 days.
          </div>
        ) : (
          <AuditTable workspaceId={workspaceId} rows={rows} />
        )}

        <p
          className="ts-11 mono mt-3"
          style={{ color: 'var(--mute2)' }}
        >
          showing {rows.length} most-recent events · last 90 days
        </p>
      </div>
    </main>
  )
}

const GROUP_LABEL: Record<AuditGroup, string> = {
  verdict: 'verdicts',
  restore: 'restores + replies',
  trust: 'trust status',
  inbox: 'inbox',
  judge: 'llm-judge runs',
  consensus: 'consensus (DS)',
  invite: 'invite rewards',
}

function buildHref(
  workspaceId: string,
  params: { q?: string; user?: string; group?: string },
): string {
  const u = new URLSearchParams()
  if (params.q) u.set('q', params.q)
  if (params.user) u.set('user', params.user)
  if (params.group) u.set('group', params.group)
  const qs = u.toString()
  return `/workspaces/${workspaceId}/audit${qs ? `?${qs}` : ''}`
}

function FilterChip({
  active,
  href,
  label,
}: {
  active: boolean
  href: string
  label: string
}) {
  return (
    <Link
      href={href}
      className="ts-12 mono px-3 py-1.5 rounded-full"
      style={{
        background: active ? 'var(--accent-soft)' : 'var(--panel)',
        color: active ? 'var(--accent)' : 'var(--mute)',
        border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
        textDecoration: 'none',
      }}
    >
      {label}
    </Link>
  )
}

function AuditTable({
  workspaceId,
  rows,
}: {
  workspaceId: string
  rows: AuditRow[]
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.id}>
          <AuditRowCard workspaceId={workspaceId} row={r} />
        </li>
      ))}
    </ul>
  )
}

function AuditRowCard({
  workspaceId,
  row,
}: {
  workspaceId: string
  row: AuditRow
}) {
  const actorName =
    row.actorDisplayName ??
    row.actorEmail?.split('@')[0] ??
    (row.actorId ? row.actorId.slice(0, 8) : 'system')
  const subjectName =
    row.subjectDisplayName ??
    row.subjectEmail?.split('@')[0] ??
    (row.subjectUserId ? row.subjectUserId.slice(0, 8) : null)
  const verb = verbForEvent(row.type, row.payload)
  const groupColor: Record<AuditGroup | 'other', string> = {
    verdict: 'oklch(0.65 0.18 200)',
    restore: 'oklch(0.6 0.18 280)',
    trust: 'oklch(0.55 0.14 75)',
    inbox: 'var(--mute)',
    judge: 'oklch(0.5 0.13 150)',
    consensus: 'oklch(0.55 0.18 320)',
    invite: 'oklch(0.62 0.16 30)',
    other: 'var(--mute)',
  }
  const fg = groupColor[row.group]
  const detail = describeDetail(row.type, row.payload)
  return (
    <div
      className="rounded-md px-4 py-3"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderLeft: `3px solid ${fg}`,
      }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="ts-13" style={{ color: 'var(--text)' }}>
          {row.actorId ? (
            <Link
              href={`/workspaces/${workspaceId}/audit?user=${row.actorId}`}
              style={{ color: 'var(--hi)', textDecoration: 'none' }}
            >
              <strong>{actorName}</strong>
            </Link>
          ) : (
            <strong style={{ color: 'var(--mute)' }}>{actorName}</strong>
          )}{' '}
          <span style={{ color: 'var(--mute)' }}>{verb}</span>
          {subjectName && (
            <>
              {' '}
              <Link
                href={`/workspaces/${workspaceId}/audit?user=${row.subjectUserId}`}
                style={{ color: 'var(--hi)', textDecoration: 'none' }}
              >
                <strong>{subjectName}</strong>
              </Link>
            </>
          )}
        </div>
        <div
          className="ts-11 mono shrink-0"
          style={{ color: 'var(--mute2)' }}
          title={row.ts.toISOString()}
        >
          {relativeTime(row.ts)}
        </div>
      </div>
      {detail && (
        <div
          className="ts-12 mono mt-1"
          style={{ color: 'var(--mute)', whiteSpace: 'pre-wrap' }}
        >
          {detail}
        </div>
      )}
      <div
        className="ts-11 mono mt-1"
        style={{ color: 'var(--mute2)' }}
      >
        <span style={{ color: fg }}>{row.type}</span>
      </div>
    </div>
  )
}

/** Map raw event type → readable verb phrase in past tense. */
function verbForEvent(
  type: string,
  payload: Record<string, unknown>,
): string {
  switch (type) {
    case 'annotation.approved':
      return 'approved an annotation by'
    case 'annotation.rejected':
      return '打回 (rejected) an annotation by'
    case 'annotation.revised':
      return 'asked for a revision on an annotation by'
    case 'annotation.qc_passed':
      return 'passed QC on an annotation by'
    case 'annotation.restored':
      return 'restored a previous version of an annotation by'
    case 'annotation.review_replied':
      return 'replied to a reviewer on their own annotation'
    case 'workspace.trust_status_changed':
      return `flipped trust status to '${
        typeof payload.status === 'string' ? payload.status : '?'
      }' for`
    case 'workspace.seed_claimed':
      return 'claimed a seed workspace'
    case 'notification.bulk_mark_read':
      return 'marked all notifications read'
    case 'llm_judge.run_completed':
      return 'completed an LLM judge run'
    case 'llm_judge.run_failed':
      return 'failed an LLM judge run'
    case 'ds.run_completed':
      return 'ran Dawid-Skene EM truth inference'
    case 'invite_reward.granted':
      return 'invite reward granted to'
    case 'invite_reward.manual_review':
      return 'invite reward queued for review for'
    case 'invite_reward.blocked':
      return 'invite reward auto-blocked for'
    case 'invite_reward.denied':
      return 'invite reward denied for'
    default:
      return type
  }
}

/** Render the most-useful payload field for the inline detail line. */
function describeDetail(
  type: string,
  payload: Record<string, unknown>,
): string | null {
  // Verdict types: surface the reviewer's feedback verbatim (it's the
  // single most useful thing the admin wants to read in audit search).
  if (
    type === 'annotation.rejected' ||
    type === 'annotation.revised' ||
    type === 'annotation.approved' ||
    type === 'annotation.qc_passed'
  ) {
    const fb =
      typeof payload.feedback === 'string' ? payload.feedback.trim() : ''
    if (fb) return `“${truncate(fb, 240)}”`
    return null
  }
  if (type === 'annotation.restored') {
    const reason =
      typeof payload.reason === 'string' ? payload.reason.trim() : ''
    const sourceKind =
      typeof payload.sourceKind === 'string' ? payload.sourceKind : null
    return (
      (sourceKind ? `from ${sourceKind} revision` : 'rolled back') +
      (reason ? ` — “${truncate(reason, 240)}”` : '')
    )
  }
  if (type === 'workspace.trust_status_changed') {
    const reason =
      typeof payload.reason === 'string' ? payload.reason.trim() : ''
    return reason ? `“${truncate(reason, 240)}”` : null
  }
  if (type === 'llm_judge.run_completed') {
    const score = payload.agreementScore
    const samples = payload.samples
    if (typeof score === 'number' && typeof samples === 'number') {
      return `${Math.round(score * 100)}% agreement · ${samples} samples`
    }
    return null
  }
  if (type === 'ds.run_completed') {
    const cells = payload.cellCount
    const raters = payload.raterCount
    const iters = payload.iterations
    const converged = payload.converged
    if (
      typeof cells === 'number' &&
      typeof raters === 'number' &&
      typeof iters === 'number'
    ) {
      return `${cells} cells · ${raters} raters · ${iters} EM iter${converged ? ' ✓' : ' (cap)'}`
    }
    return null
  }
  if (
    type === 'invite_reward.granted' ||
    type === 'invite_reward.manual_review' ||
    type === 'invite_reward.blocked' ||
    type === 'invite_reward.denied'
  ) {
    const amount = payload.amountMinor
    const currency = payload.currency
    const reason = payload.reason
    const parts: string[] = []
    if (typeof amount === 'number' && typeof currency === 'string') {
      parts.push(`${currency} ${(amount / 100).toFixed(2)}`)
    }
    if (typeof reason === 'string' && reason.trim().length > 0) {
      parts.push(`"${truncate(reason.trim(), 200)}"`)
    }
    return parts.length > 0 ? parts.join(' · ') : null
  }
  return null
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return d.toISOString().slice(5, 10).replace('-', '/')
}
