import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  stepAnnotations,
  tasks,
  topics,
  trajectories,
  trajectorySteps,
  workspaceApiKeys,
  workspaces,
} from '@/lib/db/schema'
import {
  optionalUser,
  requireWorkspaceMember,
} from '@/lib/auth/guards'
import { LiveActivityStrip } from '@/components/workspaces/live-activity-strip'
import { isFocusMode } from '@/lib/workspace-nav'

/**
 * Workspace dashboard.
 *
 * Server Component: awaits Next 16 async params, queries DB for live counts,
 * renders summary.
 *
 * **Access control**: signed-in workspace members only. Unauth visitors get
 * redirected to /signin with next=this URL. Non-members get a generic 404
 * (we deliberately don't distinguish "doesn't exist" from "not yours" so
 * existence of a workspace doesn't leak across tenants).
 */
export default async function WorkspacePage(
  props: PageProps<'/workspaces/[id]'>,
) {
  const { id } = await props.params

  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${id}`)
  try {
    await requireWorkspaceMember(id)
  } catch {
    notFound()
  }

  let workspace: typeof workspaces.$inferSelect | null = null
  let dbError: string | null = null
  let stats: {
    trajCount: number
    stepCount: number
    apiKeyCount: number
    eventCount: number
    markedSteps: number
    taskCount: number
    topicCount: number
    submittedAnnotations: number
    last: { ts: Date; agent: string; id: string } | null
  } = {
    trajCount: 0,
    stepCount: 0,
    apiKeyCount: 0,
    eventCount: 0,
    markedSteps: 0,
    taskCount: 0,
    topicCount: 0,
    submittedAnnotations: 0,
    last: null,
  }
  let recentEvents: Array<{
    id: string
    type: string
    ts: Date
    actorId: string | null
  }> = []

  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .limit(1)
    workspace = rows[0] ?? null
    if (workspace) {
      // Mode-aware fan-out:
      //   - common queries (events, tasks, topics, submitted annotations)
      //     run for every workspace
      //   - trajectory-flavored queries (trajectories, steps, marked
      //     coverage, api keys, latest capture) only fire for
      //     agent-trace-eval workspaces — pair/arena dashboards skip them
      //     entirely so we don't pay 5 round-trips for guaranteed-zero
      //     results.
      const isTrajectoryMode = workspace.templateMode === 'agent-trace-eval'
      const trajectoryQueries = isTrajectoryMode
        ? ([
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
          ] as const)
        : null

      const [
        [evtRow],
        [taskRow],
        [topicRow],
        [submittedRow],
        trajectoryResults,
      ] = await Promise.all([
        db
          .select({ n: count() })
          .from(events)
          .where(eq(events.workspaceId, id)),
        db
          .select({ n: count() })
          .from(tasks)
          .where(eq(tasks.workspaceId, id)),
        db
          .select({ n: count() })
          .from(topics)
          .innerJoin(tasks, eq(topics.taskId, tasks.id))
          .where(eq(tasks.workspaceId, id)),
        db
          .select({ n: count() })
          .from(annotations)
          .innerJoin(topics, eq(topics.id, annotations.topicId))
          .innerJoin(tasks, eq(tasks.id, topics.taskId))
          .where(
            and(
              eq(tasks.workspaceId, id),
              sql`${annotations.submittedAt} is not null`,
            ),
          ),
        trajectoryQueries
          ? Promise.all(trajectoryQueries)
          : Promise.resolve(null),
      ])
      const [trajRow, stepRow, keyRow, markedRow, latestList] =
        trajectoryResults
          ? ([
              trajectoryResults[0][0],
              trajectoryResults[1][0],
              trajectoryResults[2][0],
              trajectoryResults[3][0],
              trajectoryResults[4],
            ] as const)
          : ([undefined, undefined, undefined, undefined, []] as const)
      // Fan out a parallel fetch for the recent-activity panel — 8 events
      // is enough for "is the workspace alive?" without dragging the page TTI.
      recentEvents = await db
        .select({
          id: events.id,
          type: events.type,
          ts: events.ts,
          actorId: events.actorId,
        })
        .from(events)
        .where(eq(events.workspaceId, id))
        .orderBy(desc(events.ts))
        .limit(8)
      stats = {
        trajCount: trajRow?.n ?? 0,
        stepCount: stepRow?.n ?? 0,
        apiKeyCount: keyRow?.n ?? 0,
        eventCount: evtRow?.n ?? 0,
        markedSteps: markedRow?.n ?? 0,
        taskCount: taskRow?.n ?? 0,
        topicCount: topicRow?.n ?? 0,
        submittedAnnotations: submittedRow?.n ?? 0,
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
        <h1 className="lh-h2 mb-3" style={{ color: 'var(--hi)' }}>
          Database not configured
        </h1>
        <p className="lh-body" style={{ color: 'var(--mute2)' }}>
          Set <span className="lh-mono">DATABASE_URL</span> in{' '}
          <span className="lh-mono">.env.local</span>, then run{' '}
          <span className="lh-mono">npm run db:push</span> to create tables.
          Refresh after.
        </p>
        <pre
          className="lh-mono lh-body-sm mt-6 p-4 overflow-auto whitespace-pre-wrap"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            color: 'var(--mute2)',
          }}
        >
          {dbError}
        </pre>
      </main>
    )
  }

  if (!workspace) notFound()

  // Focus mode (default ON) hides the gateway-era cockpit tiles so the
  // workspace only surfaces the core annotation flow. See lib/workspace-nav.
  const focus = isFocusMode()

  return (
    <main className="max-w-[1280px] mx-auto px-6 py-20">
      <div
        className="lh-mono lh-caption mb-3"
        style={{ color: 'oklch(0.6 0.18 280)' }}
      >
        §  WORKSPACE
      </div>
      <h1 className="lh-h1 mb-2" style={{ color: 'var(--hi)' }}>
        {workspace.name}
      </h1>
      <div className="lh-mono lh-body-sm mb-6" style={{ color: 'var(--mute)' }}>
        {workspace.templateMode} · created{' '}
        {new Date(workspace.createdAt).toLocaleString()}
      </div>

      {/*
        Focus-mode affordance. When focus mode is ON (default), the gateway-era
        marketplace tiles (Billing / Analyze / Disputes / Judges) are hidden so
        the cockpit only surfaces the core annotation flow. Without a hint, an
        admin who expects those tiles just sees them "missing". This badge
        explains why and links to settings where the env toggle is documented.
      */}
      {focus && (
        <div
          className="lh-mono lh-body-sm mb-6 inline-flex items-center gap-2 rounded-lg"
          style={{
            color: 'var(--mute)',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            padding: '6px 12px',
          }}
        >
          <span aria-hidden>🔍</span>
          <span>Core annotations only — gateway sections hidden</span>
          <Link
            href={`/workspaces/${id}/settings`}
            className="lh-mono"
            style={{
              color: 'oklch(0.6 0.18 280)',
              textDecoration: 'none',
            }}
          >
            settings →
          </Link>
        </div>
      )}

      {/* Phase-19 live activity strip. Member-readable; everyone in
          the workspace sees the same feed. Self-hides until the first
          poll returns. */}
      <LiveActivityStrip workspaceId={id} />

      {/*
        Mode-aware tile grid.
        Trajectory-only tiles (TRAJECTORIES, ANNOTATED, API KEYS, PROVIDERS,
        EVAL-RUN) make no sense for pair-rubric / arena-gsb workspaces —
        those modes don't capture agent traces or run upstream LLMs through
        the proxy. Showing them clutters the cockpit and links to dead-end
        pages. Gate on templateMode.
      */}
      <div className="mt-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
        {workspace.templateMode === 'agent-trace-eval' && (
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
        )}
        <StatTile
          label="TASKS"
          value={stats.taskCount.toString()}
          hint={
            stats.taskCount === 0
              ? 'create your first task'
              : `${stats.topicCount} topic${stats.topicCount === 1 ? '' : 's'} total`
          }
          href={`/workspaces/${id}/tasks`}
          accent={stats.taskCount > 0}
        />
        {workspace.templateMode === 'agent-trace-eval' && (
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
        )}
        {workspace.templateMode === 'agent-trace-eval' && (
          <StatTile
            label="API KEYS"
            value={stats.apiKeyCount.toString()}
            hint={
              stats.apiKeyCount === 0
                ? 'create a key + see endpoints'
                : 'manage keys / view endpoints'
            }
            href={`/workspaces/${id}/api`}
          />
        )}
        {workspace.templateMode === 'agent-trace-eval' && (
          <StatTile
            label="PROVIDERS"
            value="↗"
            hint="manage upstream LLM keys"
            href={`/workspaces/${id}/connections`}
          />
        )}
        {!focus && (
          <StatTile
            label="DISPUTES"
            value="⚡"
            hint="IAA + AI guideline refiner"
            href={`/workspaces/${id}/disputes`}
          />
        )}
        <StatTile
          label="QUALITY"
          value="★"
          hint="gold standards · trust · calibration"
          href={`/workspaces/${id}/quality`}
        />
        {workspace.templateMode !== 'agent-trace-eval' && !focus && (
          <StatTile
            label="JUDGES"
            value="⚖"
            hint="configure LLM judges · measure agreement"
            href={`/workspaces/${id}/judges`}
          />
        )}
        {!focus && (
          <StatTile
            label="ANALYZE"
            value="◔"
            hint="filter + aggregate + ask Claude"
            href={`/workspaces/${id}/analyze`}
          />
        )}
        <StatTile
          label="EVENTS"
          value={stats.eventCount.toString()}
          hint="audit log entries"
          href={`/workspaces/${id}/activity`}
        />
        <StatTile
          label="AUDIT"
          value="🔍"
          hint="search send-backs / restore / trust by person"
          href={`/workspaces/${id}/audit`}
        />
        {workspace.templateMode === 'agent-trace-eval' && (
          <StatTile
            label="EVAL-RUN"
            value="↗"
            hint="start an agent run"
            href={`/workspaces/${id}/eval-runs/new`}
          />
        )}
        <StatTile
          label="MEMBERS"
          value="↗"
          hint="invite + manage roles"
          href={`/workspaces/${id}/members`}
        />
        {!focus && (
          <StatTile
            label="BILLING"
            value="↗"
            hint="payout periods + spend"
            href={`/workspaces/${id}/billing`}
          />
        )}
        <StatTile
          label="SETTINGS"
          value="⚙"
          hint="rename, template info"
          href={`/workspaces/${id}/settings`}
        />
      </div>

      {/*
        Mode-aware onboarding. Trajectory mode wants the SDK / capture /
        annotate path; pair-rubric and arena-gsb want create-task /
        add-topics / publish. We branch on workspace.templateMode and
        show the right CTAs.
      */}
      {workspace.templateMode === 'agent-trace-eval' && stats.trajCount === 0 && (
        <div className="mt-10">
          <GetStartedEyebrow href="/docs" />
          <div
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
            style={{ maxWidth: 900 }}
          >
            <NextStepCard
              n={1}
              done={stats.apiKeyCount > 0}
              title="Create a workspace API key"
              body="Click 'New key' on the API page to mint one in-browser (shown once). Authorizes proxy calls + SDK ingest."
              href={`/workspaces/${id}/api`}
            />
            <NextStepCard
              n={2}
              done={stats.trajCount > 0}
              title="Capture your first trajectory"
              body="Point your agent at /api/proxy/{provider}/* with the key — every call is captured. No code? Paste a trajectory on the Trajectories page, or run an Eval-Run."
              href={`/workspaces/${id}/trajectories`}
            />
            <NextStepCard
              n={3}
              done={stats.markedSteps > 0}
              title="Annotate your own trace"
              body="Open the trajectory, score each step against the rubric. Claude pre-annotates; your marks autosave."
              href={`/workspaces/${id}/trajectories`}
            />
          </div>
        </div>
      )}

      {(workspace.templateMode === 'pair-rubric' ||
        workspace.templateMode === 'arena-gsb') &&
        stats.taskCount === 0 && (
          <div className="mt-10">
            <GetStartedEyebrow href="/docs" />
            <div
              className="grid grid-cols-1 md:grid-cols-3 gap-3"
              style={{ maxWidth: 900 }}
            >
              <NextStepCard
                n={1}
                done={stats.taskCount > 0}
                title="Create your first task"
                body={
                  workspace.templateMode === 'pair-rubric'
                    ? 'Pick which yes/no rubric items annotators will answer. Five sensible presets ship by default — add your own or trim the list.'
                    : 'Pick the GSB dimensions annotators score on a 1–5 scale. Five sensible defaults ship; customize per task.'
                }
                href={`/workspaces/${id}/tasks/new`}
              />
              <NextStepCard
                n={2}
                done={stats.topicCount > 0}
                title="Add topics (prompt + 2 model responses)"
                body="Open the task detail page and paste in prompts with each model's answer. One row per pair-comparison."
                href={`/workspaces/${id}/tasks`}
              />
              <NextStepCard
                n={3}
                done={stats.submittedAnnotations > 0}
                title="Publish + share with annotators"
                body="Hit publish so topics show up in /my/queue for every member. The first annotator to click claims the row."
                href={`/workspaces/${id}/tasks`}
              />
            </div>
          </div>
        )}

      {workspace.templateMode === 'custom-designer' && stats.taskCount === 0 && (
        <div className="mt-10">
          <GetStartedEyebrow href="/docs" />
          <div
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
            style={{ maxWidth: 900 }}
          >
            <NextStepCard
              n={1}
              done={stats.taskCount > 0}
              title="Design your form template"
              body="Drag fields onto the canvas in the Designer — text, choices, file upload, JSON, LLM assist, ShowItem — then save a serializable schema."
              href="/admin/forms/new"
            />
            <NextStepCard
              n={2}
              done={stats.topicCount > 0}
              title="Create a task + import topics"
              body="Bind the task to your saved form, then import the dataset to label (JSON / JSONL / Excel) and preview the topics."
              href={`/workspaces/${id}/tasks/new`}
            />
            <NextStepCard
              n={3}
              done={stats.submittedAnnotations > 0}
              title="Publish + share with annotators"
              body="Publish so topics appear in /my/queue for every member. Submissions then flow into AI pre-review and human QC."
              href={`/workspaces/${id}/tasks`}
            />
          </div>
        </div>
      )}

      {stats.last && (
        <div className="mt-10">
          <div
            className="lh-mono lh-caption mb-2"
            style={{ color: 'var(--mute)', letterSpacing: '0.06em' }}
          >
            § MOST RECENT CAPTURE
          </div>
          <Link
            href={`/workspaces/${id}/trajectories/${stats.last.id}`}
            className="block p-4 rounded-xl"
            style={{
              border: '1px solid var(--line)',
              background: 'var(--panel)',
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
                  style={{ color: 'var(--mute)', fontSize: 12 }}
                >
                  {new Date(stats.last.ts).toLocaleString()}
                </div>
              </div>
              <span
                className="lh-mono"
                style={{ color: 'var(--mute2)', fontSize: 12 }}
              >
                open →
              </span>
            </div>
          </Link>
        </div>
      )}

      {recentEvents.length > 0 && (
        <div className="mt-10">
          <div
            className="lh-mono lh-caption mb-2 flex items-center justify-between"
            style={{
              color: 'var(--mute)',
              letterSpacing: '0.06em',
            }}
          >
            <span>§ RECENT ACTIVITY</span>
            <Link
              href={`/workspaces/${id}/activity`}
              className="lh-mono"
              style={{
                color: 'oklch(0.6 0.18 280)',
                textDecoration: 'none',
                fontSize: 11,
              }}
            >
              view all →
            </Link>
          </div>
          <ul
            className="rounded-xl overflow-hidden"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            {recentEvents.map((e, idx) => (
              <li
                key={e.id}
                className="flex items-center gap-3 px-4 py-2 lh-mono"
                style={{
                  borderTop:
                    idx === 0 ? 'none' : '1px solid var(--line)',
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    color: 'var(--mute)',
                    width: 130,
                    flexShrink: 0,
                  }}
                  title={e.ts.toISOString()}
                >
                  {formatRelativeTime(e.ts)}
                </span>
                <span
                  style={{
                    color: 'oklch(0.78 0.12 280)',
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {e.type}
                </span>
                {!e.actorId && (
                  <span
                    style={{
                      color: 'var(--mute2)',
                      fontSize: 11,
                    }}
                  >
                    system
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className="mt-10 lh-body-sm"
        style={{ color: 'var(--mute2)' }}
      >
        Workspace ID:{' '}
        <span className="lh-mono" style={{ color: 'var(--mute2)' }}>
          {workspace.id}
        </span>
      </div>
    </main>
  )
}

/**
 * Compact relative time formatter — "2m ago", "3h ago", "yesterday", "May 14".
 *
 * Kept here vs in a shared lib because nothing else in the project needs it
 * yet, and inlining keeps the dashboard self-contained.
 */
function formatRelativeTime(ts: Date): string {
  const now = Date.now()
  const diff = now - ts.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day === 1) return 'yesterday'
  if (day < 7) return `${day}d ago`
  return ts.toISOString().slice(5, 10).replace('-', '/')
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
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: 'var(--panel)',
        transition: 'border-color 160ms',
      }}
    >
      <div
        className="lh-mono lh-caption mb-2"
        style={{ color: 'var(--mute2)', letterSpacing: '0.06em' }}
      >
        {label}
      </div>
      <div
        className="lh-h2 lh-mono"
        style={{
          color: accent ? 'oklch(0.6 0.18 280)' : 'var(--hi)',
        }}
      >
        {value}
      </div>
      <div
        className="lh-caption mt-2"
        style={{ color: 'var(--mute)' }}
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

/**
 * Onboarding step card — surfaces ONLY on a fresh workspace
 * (when the user has no captures yet). Once trajectories exist this section
 * is replaced by the "MOST RECENT CAPTURE" link.
 *
 * Each card has its own checkmark when the step is done — a soft signal of
 * "you're 1/3 through" without a full progress bar.
 */
function NextStepCard({
  n,
  done,
  title,
  body,
  href,
}: {
  n: number
  done: boolean
  title: string
  body: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="block p-5 rounded-xl relative"
      style={{
        background: done ? 'oklch(0.5 0.13 150 / 0.06)' : 'var(--panel)',
        border: done
          ? '1px solid oklch(0.5 0.13 150 / 0.4)'
          : '1px solid var(--line)',
        textDecoration: 'none',
        transition: 'border-color 120ms',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div
          className="lh-mono"
          style={{
            color: done ? 'oklch(0.7 0.13 150)' : 'oklch(0.6 0.18 280)',
            fontSize: 11,
            letterSpacing: '0.06em',
          }}
        >
          STEP {n} {done ? '· DONE' : ''}
        </div>
        <span
          aria-hidden
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: done ? 'oklch(0.5 0.13 150)' : 'transparent',
            border: done
              ? '1px solid oklch(0.5 0.13 150)'
              : '1px solid var(--line2)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: 11,
          }}
        >
          {done ? '✓' : ''}
        </span>
      </div>
      <h3
        className="lh-h4 mb-1"
        style={{
          color: 'var(--hi)',
          fontSize: 15,
        }}
      >
        {title}
      </h3>
      <p
        className="lh-body-sm"
        style={{ color: 'var(--mute)', lineHeight: 1.5 }}
      >
        {body}
      </p>
    </Link>
  )
}

/**
 * "§ GET STARTED · 3 STEPS" eyebrow shared by the three mode-specific
 * onboarding blocks. Mirrors the "§ RECENT ACTIVITY … view all →" header
 * row: the eyebrow on the left, a docs quick-link on the right so a
 * first-run admin always has a "where do I read more?" exit alongside the
 * inline step cards. This affordance is self-dismissing — the whole block
 * only renders while the workspace has zero tasks/captures, then disappears
 * once the first step is done.
 */
function GetStartedEyebrow({ href }: { href: string }) {
  return (
    <div
      className="lh-mono lh-caption mb-3 flex items-center justify-between"
      style={{ color: 'oklch(0.6 0.18 280)', letterSpacing: '0.06em' }}
    >
      <span>§ GET STARTED · 3 STEPS</span>
      <Link
        href={href}
        className="lh-mono"
        style={{
          color: 'oklch(0.6 0.18 280)',
          textDecoration: 'none',
          fontSize: 11,
        }}
      >
        read the docs →
      </Link>
    </div>
  )
}
