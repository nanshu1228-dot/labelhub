import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { listTrajectoriesWithStepStats } from '@/lib/queries/trajectories'
import { listDisputeCountsByTrajectory } from '@/lib/queries/iaa'
import { TRAJECTORY_SOURCES, type TrajectorySource } from '@/lib/trajectories/schema'

export const metadata: Metadata = {
  title: 'Trajectories — LabelHub',
}

/**
 * /workspaces/[id]/trajectories
 *
 * Server Component. Lists captured trajectories for a workspace, newest first.
 * Each row links into the detail page where steps render in full.
 *
 * Read-only by design — this is the "inbox" view. The annotation UI is at
 * /workspaces/[id]/trajectories/[trajId] and edits go through Server Actions
 * (so the list stays cacheable + cheap to render).
 *
 * Filters via search params:
 *   ?source=production|eval-run|synthetic|upload — exact match on source
 *   ?agent=<substring>                            — case-insensitive contains
 * Filters are applied AFTER the DB fetch (limit 100). Cheap enough at MVP
 * scale; promote to query-level filtering when the workspace grows past ~1k.
 */
export default async function TrajectoriesListPage(
  props: PageProps<'/workspaces/[id]/trajectories'>,
) {
  const { id: workspaceId } = await props.params
  const search = await props.searchParams
  const sourceFilter = typeof search?.source === 'string' ? search.source : null
  const agentFilter =
    typeof search?.agent === 'string' && search.agent.trim().length > 0
      ? search.agent.trim().toLowerCase()
      : null

  // Resolve workspace name for the breadcrumb. Tolerate missing DB so the
  // page still renders the design when developing locally without Supabase.
  let workspaceName = 'workspace'
  let dbError: string | null = null
  let rows: Awaited<ReturnType<typeof listTrajectoriesWithStepStats>> = []
  let totalBeforeFilters = 0
  let disputeCounts: Map<string, number> = new Map()

  try {
    const workspace = await getWorkspaceById(workspaceId)
    if (!workspace) notFound()
    workspaceName = workspace.name
    const all = await listTrajectoriesWithStepStats(workspaceId, { limit: 100 })
    totalBeforeFilters = all.length
    rows = all.filter((r) => {
      if (sourceFilter && r.source !== sourceFilter) return false
      if (agentFilter && !r.agentName.toLowerCase().includes(agentFilter))
        return false
      return true
    })
    // Pull dispute counts for the visible page in one query.
    disputeCounts = await listDisputeCountsByTrajectory(
      workspaceId,
      rows.map((r) => r.id),
    )
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="app-light min-h-screen">
      <Header workspaceId={workspaceId} workspaceName={workspaceName} />

      <main className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="flex items-end justify-between gap-6 mb-6">
          <div>
            <div className="lbl mb-2">§ CAPTURED TRAJECTORIES</div>
            <h1 className="ts-32" style={{ color: 'var(--hi)' }}>
              Trajectories
            </h1>
            <p
              className="ts-13 mt-1"
              style={{ color: 'var(--mute)' }}
            >
              Every agent run that hit this workspace — proxy, SDK ingest, or
              Eval-Run.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/workspaces/${workspaceId}/eval-runs/new`}
              className="lh-btn lh-btn-ghost"
            >
              ← Back to Eval-Run
            </Link>
          </div>
        </div>

        {!dbError && totalBeforeFilters > 0 && (
          <FilterBar
            workspaceId={workspaceId}
            activeSource={sourceFilter}
            agentFilter={agentFilter}
          />
        )}

        {dbError ? (
          <DbError message={dbError} />
        ) : totalBeforeFilters === 0 ? (
          <Empty workspaceId={workspaceId} />
        ) : rows.length === 0 ? (
          <FilteredEmpty workspaceId={workspaceId} />
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id}>
                <TrajectoryRow
                  workspaceId={workspaceId}
                  row={row}
                  disputeCount={disputeCounts.get(row.id) ?? 0}
                />
              </li>
            ))}
          </ul>
        )}

        {rows.length > 0 && (
          <div
            className="mt-6 ts-12 mono text-center"
            style={{ color: 'var(--mute2)' }}
          >
            showing {rows.length}
            {rows.length < totalBeforeFilters && (
              <> of {totalBeforeFilters} (filtered)</>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Header({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string
  workspaceName: string
}) {
  return (
    <header
      className="hairline-b"
      style={{ background: 'var(--panel)' }}
    >
      <div className="mx-auto max-w-[1200px] flex items-center justify-between px-6 py-3">
        <nav
          className="ts-12 mono flex items-center gap-1.5"
          style={{ color: 'var(--mute2)' }}
        >
          <Link
            href={`/workspaces/${workspaceId}`}
            className="truncate-1 hover:underline"
            style={{ color: 'var(--text)', maxWidth: 200 }}
          >
            {workspaceName}
          </Link>
          <span>/</span>
          <span style={{ color: 'var(--hi)' }}>trajectories</span>
        </nav>
        <Logo />
      </div>
    </header>
  )
}

function Logo() {
  return (
    <Link
      href="/"
      className="ts-13 mono"
      style={{ color: 'var(--hi)' }}
      aria-label="LabelHub"
    >
      <span style={{ color: 'var(--accent)' }}>§</span> labelhub
    </Link>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function TrajectoryRow({
  workspaceId,
  row,
  disputeCount,
}: {
  workspaceId: string
  row: Awaited<ReturnType<typeof listTrajectoriesWithStepStats>>[number]
  disputeCount: number
}) {
  const created = new Date(row.createdAt)
  const finalPreview = row.finalResponse
    ? row.finalResponse.length > 220
      ? row.finalResponse.slice(0, 220) + '…'
      : row.finalResponse
    : '(no final response — tool calls only or error)'
  const rootPreview =
    row.rootPrompt.length > 140
      ? row.rootPrompt.slice(0, 140) + '…'
      : row.rootPrompt

  // Pluck qc reasons out of meta (jsonb). Used to render the data-integrity
  // chip so an annotator never opens a row blindly trusting it.
  const meta = (row.meta ?? {}) as Record<string, unknown>
  const qcReasons =
    ((meta.qcFlags as { reasons?: Array<{ kind: string }> } | null)?.reasons ??
      []) as Array<{ kind: string }>

  return (
    <Link
      href={`/workspaces/${workspaceId}/trajectories/${row.id}`}
      className="traj-card block"
      style={{ textDecoration: 'none' }}
    >
      <div className="traj-head">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <SourceBadge source={row.source} />
            {qcReasons.length > 0 && <QcChip reasons={qcReasons} />}
            {disputeCount > 0 && <DisputeChip count={disputeCount} />}
            <span
              className="ts-13 mono truncate-1"
              style={{ color: 'var(--hi)', minWidth: 0 }}
            >
              {row.agentName}
            </span>
          </div>
          <div
            className="ts-13 truncate-1"
            style={{ color: 'var(--text)' }}
          >
            {rootPreview}
          </div>
        </div>
        <div
          className="ts-12 mono text-right whitespace-nowrap"
          style={{ color: 'var(--mute)' }}
        >
          <div>{created.toLocaleString()}</div>
          <div className="mt-0.5" style={{ color: 'var(--mute2)' }}>
            {row.markedStepCount > 0 ? (
              <>
                <span style={{ color: 'var(--accent)' }}>
                  {row.markedStepCount}
                </span>
                /{row.stepCount} marked
              </>
            ) : (
              <>
                {row.stepCount} step{row.stepCount === 1 ? '' : 's'}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="traj-summary">
        <KindHistogram byKind={row.stepsByKind} />
        <div
          className="ts-13"
          style={{ color: 'var(--mute)', whiteSpace: 'pre-wrap' }}
        >
          {finalPreview}
        </div>
      </div>
    </Link>
  )
}

function DisputeChip({ count }: { count: number }) {
  // Inter-annotator dispute — the signal feeding the Guideline Refiner.
  return (
    <span
      className="badge"
      style={{
        color: 'var(--danger)',
        borderColor: 'oklch(0.6 0.2 25 / 0.4)',
        background: 'var(--danger-soft)',
      }}
      title={`${count} step${count === 1 ? '' : 's'} disputed across raters (spread > 1)`}
    >
      ⚡ {count} disputed
    </span>
  )
}

function QcChip({ reasons }: { reasons: Array<{ kind: string }> }) {
  // Build a compact "⚠ N flag(s): kind1, kind2" chip. The detail page is the
  // canonical place to read the full explanations — this is just a warning
  // light so the annotator triages before opening.
  const kinds = Array.from(new Set(reasons.map((r) => r.kind))).sort()
  const label =
    kinds.length === 1
      ? kinds[0].replace('_', ' ')
      : `${reasons.length} flags`
  return (
    <span
      className="badge"
      style={{
        color: 'var(--warn)',
        borderColor: 'oklch(0.7 0.14 75 / 0.4)',
        background: 'oklch(0.7 0.14 75 / 0.08)',
      }}
      title={kinds.join(' · ')}
    >
      ⚠ {label}
    </span>
  )
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, string> = {
    production: 'green',
    'eval-run': 'violet',
    synthetic: '',
    upload: '',
  }
  const tone = map[source] ?? ''
  return <span className={`badge ${tone}`}>{source}</span>
}

const KIND_ORDER: Array<keyof typeof KIND_CLASS> = [
  'thinking',
  'tool_call',
  'tool_result',
  'final_response',
  'error',
]
const KIND_CLASS = {
  thinking: 'thinking',
  tool_call: 'tool',
  tool_result: 'result',
  final_response: 'final',
  error: 'error',
} as const

function KindHistogram({ byKind }: { byKind: Record<string, number> }) {
  const entries = KIND_ORDER.filter((k) => (byKind[k] ?? 0) > 0)
  if (entries.length === 0) return null
  return (
    <div className="kind-hist">
      {entries.map((k, i) => (
        <span key={k} className="contents">
          <span className={`hist ${KIND_CLASS[k]}`}>
            <span className="hist-n">{byKind[k]}</span>
            <span className="hist-label">{k}</span>
          </span>
          {i < entries.length - 1 && <span className="hist-sep">·</span>}
        </span>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function FilterBar({
  workspaceId,
  activeSource,
  agentFilter,
}: {
  workspaceId: string
  activeSource: string | null
  agentFilter: string | null
}) {
  const base = `/workspaces/${workspaceId}/trajectories`
  const buildHref = (next: { source?: string | null; agent?: string | null }) => {
    const params = new URLSearchParams()
    const source = next.source !== undefined ? next.source : activeSource
    const agent = next.agent !== undefined ? next.agent : agentFilter
    if (source) params.set('source', source)
    if (agent) params.set('agent', agent)
    const qs = params.toString()
    return qs ? `${base}?${qs}` : base
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <span
        className="ts-12 mono uppercase mr-1"
        style={{ color: 'var(--mute2)', letterSpacing: '0.05em' }}
      >
        source
      </span>
      <Link
        href={buildHref({ source: null })}
        className={`seg-btn ${!activeSource ? 'on' : ''}`}
        style={{
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: '0 10px',
          height: 26,
          textDecoration: 'none',
        }}
      >
        all
      </Link>
      {(TRAJECTORY_SOURCES as readonly TrajectorySource[]).map((s) => (
        <Link
          key={s}
          href={buildHref({ source: s })}
          className={`seg-btn ${activeSource === s ? 'on' : ''}`}
          style={{
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: '0 10px',
            height: 26,
            textDecoration: 'none',
          }}
        >
          {s}
        </Link>
      ))}
      {agentFilter && (
        <Link
          href={buildHref({ agent: null })}
          className="badge violet"
          style={{ textDecoration: 'none' }}
          title="Clear agent filter"
        >
          agent: {agentFilter} ×
        </Link>
      )}
    </div>
  )
}

function FilteredEmpty({ workspaceId }: { workspaceId: string }) {
  return (
    <div
      className="text-center py-12 px-6 rounded-xl"
      style={{ border: '1px dashed var(--line2)', background: 'var(--panel)' }}
    >
      <div
        className="ts-13 mono mb-2"
        style={{ color: 'var(--mute2)', letterSpacing: '0.05em' }}
      >
        § NO MATCHES
      </div>
      <p className="ts-13" style={{ color: 'var(--mute)' }}>
        No trajectories match the current filters.{' '}
        <Link
          href={`/workspaces/${workspaceId}/trajectories`}
          className="hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          Clear filters
        </Link>
      </p>
    </div>
  )
}

function Empty({ workspaceId }: { workspaceId: string }) {
  return (
    <div
      className="text-center py-16 px-6 rounded-xl"
      style={{ border: '1px dashed var(--line2)', background: 'var(--panel)' }}
    >
      <div
        className="ts-13 mono mb-3"
        style={{ color: 'var(--mute2)', letterSpacing: '0.05em' }}
      >
        §  INBOX EMPTY
      </div>
      <h2 className="ts-20 mb-2" style={{ color: 'var(--hi)' }}>
        No trajectories captured yet
      </h2>
      <p
        className="ts-13 max-w-[560px] mx-auto"
        style={{ color: 'var(--mute)' }}
      >
        Fire an agent through the Doubao proxy, the SDK, or the Eval-Run page.
        Every call lands here. Try the curl example printed by{' '}
        <span className="mono">npm run bootstrap</span>.
      </p>
      <div className="mt-6 flex items-center justify-center gap-2">
        <Link
          href={`/workspaces/${workspaceId}/eval-runs/new`}
          className="lh-btn lh-btn-accent"
        >
          Run an agent
        </Link>
      </div>
    </div>
  )
}

function DbError({ message }: { message: string }) {
  return (
    <div
      className="p-6 rounded-xl"
      style={{
        border: '1px solid var(--line)',
        background: 'var(--panel)',
      }}
    >
      <div
        className="ts-13 mono mb-2"
        style={{ color: 'var(--danger)', letterSpacing: '0.05em' }}
      >
        § DATABASE NOT REACHABLE
      </div>
      <p className="ts-13" style={{ color: 'var(--text)' }}>
        Couldn&apos;t fetch trajectories. Set{' '}
        <span className="mono">DATABASE_URL</span> in{' '}
        <span className="mono">.env.local</span> and run{' '}
        <span className="mono">npm run db:push</span>.
      </p>
      <pre
        className="mt-4 ts-12 mono p-3 overflow-auto whitespace-pre-wrap"
        style={{
          background: 'var(--code-bg)',
          border: '1px solid var(--code-line)',
          color: 'var(--code-text)',
          borderRadius: 8,
        }}
      >
        {message}
      </pre>
    </div>
  )
}
