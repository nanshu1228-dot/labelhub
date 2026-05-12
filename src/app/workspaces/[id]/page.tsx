import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  apiRequestLog,
  events,
  stepAnnotations,
  topics,
  trajectories,
  trajectorySteps,
  workspaceApiKeys,
  workspaces,
} from '@/lib/db/schema'

/**
 * Workspace dashboard.
 *
 * Server Component: awaits Next 16 async params, queries DB for live counts,
 * renders summary. Gracefully handles "DB not configured" so the redirect
 * from /workspaces/new still produces a useful page during local dev without
 * Supabase env.
 */
export default async function WorkspacePage(
  props: PageProps<'/workspaces/[id]'>,
) {
  const { id } = await props.params

  let workspace: typeof workspaces.$inferSelect | null = null
  let dbError: string | null = null
  let stats: {
    trajCount: number
    stepCount: number
    apiKeyCount: number
    eventCount: number
    markedSteps: number
    last: { ts: Date; agent: string; id: string } | null
  } = {
    trajCount: 0,
    stepCount: 0,
    apiKeyCount: 0,
    eventCount: 0,
    markedSteps: 0,
    last: null,
  }

  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .limit(1)
    workspace = rows[0] ?? null
    if (workspace) {
      // Six small parallel COUNT queries — fast even on Postgres pooler.
      const [
        [trajRow],
        [stepRow],
        [keyRow],
        [evtRow],
        [markedRow],
        latestList,
      ] = await Promise.all([
        db
          .select({ n: count() })
          .from(trajectories)
          .where(
            and(
              eq(trajectories.workspaceId, id),
              isNull(trajectories.deletedAt),
            ),
          ),
        db
          .select({ n: count() })
          .from(trajectorySteps)
          .innerJoin(
            trajectories,
            eq(trajectorySteps.trajectoryId, trajectories.id),
          )
          .where(
            and(
              eq(trajectories.workspaceId, id),
              isNull(trajectories.deletedAt),
            ),
          ),
        db
          .select({ n: count() })
          .from(workspaceApiKeys)
          .where(
            and(
              eq(workspaceApiKeys.workspaceId, id),
              isNull(workspaceApiKeys.revokedAt),
            ),
          ),
        db
          .select({ n: count() })
          .from(events)
          .where(eq(events.workspaceId, id)),
        // Count DISTINCT (trajectory_step_id) marked in this workspace —
        // captures "coverage" rather than total marks (which over-counts
        // when an annotator updates a mark).
        db
          .select({ n: sql<number>`COUNT(DISTINCT ${stepAnnotations.trajectoryStepId})::int` })
          .from(stepAnnotations)
          .innerJoin(annotations, eq(stepAnnotations.annotationId, annotations.id))
          .innerJoin(topics, eq(annotations.topicId, topics.id))
          .innerJoin(trajectorySteps, eq(stepAnnotations.trajectoryStepId, trajectorySteps.id))
          .innerJoin(trajectories, eq(trajectorySteps.trajectoryId, trajectories.id))
          .where(
            and(
              eq(trajectories.workspaceId, id),
              isNull(trajectories.deletedAt),
            ),
          ),
        db
          .select({
            id: trajectories.id,
            ts: trajectories.createdAt,
            agent: trajectories.agentName,
          })
          .from(trajectories)
          .where(
            and(
              eq(trajectories.workspaceId, id),
              isNull(trajectories.deletedAt),
            ),
          )
          .orderBy(desc(trajectories.createdAt))
          .limit(1),
      ])
      stats = {
        trajCount: trajRow?.n ?? 0,
        stepCount: stepRow?.n ?? 0,
        apiKeyCount: keyRow?.n ?? 0,
        eventCount: evtRow?.n ?? 0,
        markedSteps: markedRow?.n ?? 0,
        last: latestList[0]
          ? {
              id: latestList[0].id,
              ts: latestList[0].ts,
              agent: latestList[0].agent,
            }
          : null,
      }
    }
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e)
  }

  if (dbError) {
    return (
      <main className="max-w-[800px] mx-auto px-6 py-20">
        <div
          className="lh-mono lh-caption mb-3"
          style={{ color: 'oklch(0.6 0.2 25)' }}
        >
          §  DIAGNOSTIC
        </div>
        <h1 className="lh-h2 mb-3" style={{ color: 'oklch(0.92 0 0)' }}>
          Database not configured
        </h1>
        <p className="lh-body" style={{ color: 'oklch(0.62 0 0)' }}>
          Set <span className="lh-mono">DATABASE_URL</span> in{' '}
          <span className="lh-mono">.env.local</span>, then run{' '}
          <span className="lh-mono">npm run db:push</span> to create tables.
          Refresh after.
        </p>
        <pre
          className="lh-mono lh-body-sm mt-6 p-4 overflow-auto whitespace-pre-wrap"
          style={{
            background: 'oklch(0.155 0 0)',
            border: '1px solid oklch(0.22 0 0)',
            borderRadius: 8,
            color: 'oklch(0.62 0 0)',
          }}
        >
          {dbError}
        </pre>
      </main>
    )
  }

  if (!workspace) notFound()

  return (
    <main className="max-w-[1280px] mx-auto px-6 py-20">
      <div
        className="lh-mono lh-caption mb-3"
        style={{ color: 'oklch(0.6 0.18 280)' }}
      >
        §  WORKSPACE
      </div>
      <h1 className="lh-h1 mb-2" style={{ color: 'oklch(0.95 0 0)' }}>
        {workspace.name}
      </h1>
      <div className="lh-mono lh-body-sm" style={{ color: 'oklch(0.55 0 0)' }}>
        {workspace.templateMode} · created{' '}
        {new Date(workspace.createdAt).toLocaleString()}
      </div>

      <div className="mt-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatTile
          label="TRAJECTORIES"
          value={stats.trajCount.toString()}
          hint={
            stats.trajCount === 0
              ? 'no captures yet'
              : `${stats.stepCount} total steps`
          }
          href={`/workspaces/${id}/trajectories`}
          accent={stats.trajCount > 0}
        />
        <StatTile
          label="ANNOTATED"
          value={`${stats.markedSteps}/${stats.stepCount}`}
          hint={
            stats.stepCount === 0
              ? '—'
              : stats.markedSteps === 0
                ? 'open a trajectory to start'
                : `${Math.round((stats.markedSteps / Math.max(stats.stepCount, 1)) * 100)}% coverage`
          }
          accent={stats.markedSteps > 0}
        />
        <StatTile
          label="API KEYS"
          value={stats.apiKeyCount.toString()}
          hint={
            stats.apiKeyCount === 0
              ? 'run `npm run bootstrap` to mint one'
              : 'manage / view endpoints'
          }
          href={`/workspaces/${id}/api`}
        />
        <StatTile
          label="EVENTS"
          value={stats.eventCount.toString()}
          hint="audit log entries"
        />
        <StatTile
          label="EVAL-RUN"
          value="↗"
          hint="start an agent run"
          href={`/workspaces/${id}/eval-runs/new`}
        />
      </div>

      {stats.last && (
        <div className="mt-10">
          <div
            className="lh-mono lh-caption mb-2"
            style={{ color: 'oklch(0.55 0 0)', letterSpacing: '0.06em' }}
          >
            § MOST RECENT CAPTURE
          </div>
          <Link
            href={`/workspaces/${id}/trajectories/${stats.last.id}`}
            className="block p-4 rounded-xl"
            style={{
              border: '1px solid oklch(0.22 0 0)',
              background: 'oklch(0.13 0 0)',
              textDecoration: 'none',
            }}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div
                  className="lh-mono lh-body-sm"
                  style={{ color: 'oklch(0.78 0.12 280)' }}
                >
                  {stats.last.agent}
                </div>
                <div
                  className="lh-mono mt-1"
                  style={{ color: 'oklch(0.55 0 0)', fontSize: 12 }}
                >
                  {new Date(stats.last.ts).toLocaleString()}
                </div>
              </div>
              <span
                className="lh-mono"
                style={{ color: 'oklch(0.62 0 0)', fontSize: 12 }}
              >
                open →
              </span>
            </div>
          </Link>
        </div>
      )}

      <div
        className="mt-10 lh-body-sm"
        style={{ color: 'oklch(0.42 0 0)' }}
      >
        Workspace ID:{' '}
        <span className="lh-mono" style={{ color: 'oklch(0.62 0 0)' }}>
          {workspace.id}
        </span>
      </div>
    </main>
  )
}

function StatTile({
  label,
  value,
  hint,
  accent,
  href,
}: {
  label: string
  value: string
  hint: string
  accent?: boolean
  href?: string
}) {
  const body = (
    <div
      className="p-6 h-full"
      style={{
        border: '1px solid oklch(0.22 0 0)',
        borderRadius: 12,
        background: 'oklch(0.13 0 0)',
        transition: 'border-color 160ms',
      }}
    >
      <div
        className="lh-mono lh-caption mb-2"
        style={{ color: 'oklch(0.42 0 0)', letterSpacing: '0.06em' }}
      >
        {label}
      </div>
      <div
        className="lh-h2 lh-mono"
        style={{
          color: accent ? 'oklch(0.6 0.18 280)' : 'oklch(0.92 0 0)',
        }}
      >
        {value}
      </div>
      <div
        className="lh-caption mt-2"
        style={{ color: 'oklch(0.55 0 0)' }}
      >
        {hint}
      </div>
    </div>
  )
  return href ? (
    <Link href={href} style={{ textDecoration: 'none' }}>
      {body}
    </Link>
  ) : (
    body
  )
}
