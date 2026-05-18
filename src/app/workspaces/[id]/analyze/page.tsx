import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { optionalUser, requireWorkspaceMember } from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { count, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { trajectories } from '@/lib/db/schema'
import {
  computeAggregates,
  listTrajectoriesByFilter,
  parseFilter,
  stringifyFilter,
  type AnalyzeRow,
} from '@/lib/queries/analyze'
import { AnalyzeClient } from '@/components/analyze/analyze-client'
import { ToolProvidersPanel } from '@/components/analyze/tool-providers-panel'
import { getWorkspaceToolCallStats } from '@/lib/queries/tool-call-audit'

export const metadata: Metadata = {
  title: 'Analyze — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/analyze — admin's batch-trajectory inspection surface.
 *
 * SSR loads:
 *   - parsed filter from ?q=...
 *   - matching trajectories (≤500) + aggregates over them
 *   - workspace name for breadcrumb
 * Client takes over for:
 *   - typing filter
 *   - asking the analyst LLM
 *
 * Admin-only. Member-readable would leak workspace-wide patterns.
 */
export default async function AnalyzePage(
  props: PageProps<'/workspaces/[id]/analyze'>,
) {
  const { id: workspaceId } = await props.params
  const search = await props.searchParams
  const filterString =
    typeof search?.q === 'string' ? search.q : ''

  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${workspaceId}/analyze`)

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  const { role } = await requireWorkspaceMember(workspaceId)
  const isAdmin = role === 'admin' || workspace.adminId === me.id

  if (!isAdmin) {
    return (
      <Shell workspaceName={workspace.name} workspaceId={workspaceId}>
        <div
          className="rounded-xl p-6"
          style={{
            background: 'var(--panel)',
            border: '1px dashed var(--line2)',
          }}
        >
          <h3 className="ts-16" style={{ color: 'var(--hi)' }}>
            Admin-only
          </h3>
          <p className="ts-13 mt-2" style={{ color: 'var(--mute)' }}>
            Cross-trajectory analysis is workspace-admin operational
            information. Annotators see only their own work.
          </p>
        </div>
      </Shell>
    )
  }

  const filter = parseFilter(filterString)
  const db = getDb()
  const [rows, totalRow, toolStats] = await Promise.all([
    listTrajectoriesByFilter({
      workspaceId,
      filter,
      limit: 500,
    }),
    db
      .select({ n: count() })
      .from(trajectories)
      .where(eq(trajectories.workspaceId, workspaceId)),
    getWorkspaceToolCallStats(workspaceId).catch(() => []),
  ])
  const aggregates = computeAggregates(rows)
  const hasAnyTrajectories = Number(totalRow[0]?.n ?? 0) > 0

  return (
    <Shell workspaceName={workspace.name} workspaceId={workspaceId}>
      <div className="space-y-10">
        <AnalyzeClient
          workspaceId={workspaceId}
          initialFilterString={filterString}
          canonicalFilter={stringifyFilter(filter)}
          rowsPreview={rows.slice(0, 12).map(rowPreview)}
          rowsTotal={rows.length}
          aggregates={aggregates}
          hasAnyTrajectories={hasAnyTrajectories}
        />
        {/* Phase-20: tool-provider audit lens. Only shown when the
            workspace has any captured trajectories — the analyze
            empty card already handles the truly-empty case. */}
        {hasAnyTrajectories && <ToolProvidersPanel rows={toolStats} />}
      </div>
    </Shell>
  )
}

function rowPreview(r: AnalyzeRow) {
  return {
    id: r.id,
    agentName: r.agentName,
    createdAt: r.createdAt.toISOString(),
    outcome: r.features?.outcome ?? 'incomplete',
    stepCount: r.features?.stepCount ?? 0,
    loopDetected: !!r.features?.loopDetected,
    summary: r.summary ?? null,
    summaryPattern: r.summaryPattern ?? null,
    topTool:
      r.features?.toolUsage
        ? topToolName(r.features.toolUsage)
        : null,
  }
}

function topToolName(usage: Record<string, number>): string | null {
  let best: { name: string; c: number } | null = null
  for (const [k, v] of Object.entries(usage)) {
    if (!best || v > best.c) best = { name: k, c: v }
  }
  return best?.name ?? null
}

function Shell({
  workspaceId,
  workspaceName,
  children,
}: {
  workspaceId: string
  workspaceName: string
  children: React.ReactNode
}) {
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
              {workspaceName}
            </Link>
            <span>/</span>
            <span style={{ color: 'var(--hi)' }}>analyze</span>
          </nav>
          <Link href="/" className="ts-13 mono" style={{ color: 'var(--hi)' }}>
            <span style={{ color: 'var(--accent)' }}>§</span> labelhub
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="mb-6">
          <div className="lbl mb-2">§ ANALYZE</div>
          <h1 className="ts-32" style={{ color: 'var(--hi)' }}>
            Batch trajectory analysis
          </h1>
          <p
            className="ts-13 mt-1"
            style={{ color: 'var(--mute)', maxWidth: 720 }}
          >
            Filter by feature, see the aggregate at a glance, then ask Claude
            for a diagnosis. Raw trajectories never leave the database —
            the analyst sees pre-cached summaries + aggregates only.
          </p>
        </div>
        {children}
      </main>
    </div>
  )
}
