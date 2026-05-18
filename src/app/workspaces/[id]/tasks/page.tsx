import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { topics } from '@/lib/db/schema'
import {
  optionalUser,
  requireWorkspaceMember,
} from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { listTasksInWorkspace } from '@/lib/queries/tasks'

export const metadata: Metadata = {
  title: 'Tasks — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/tasks
 *
 * Index of all tasks in the workspace. Admin gets a "+ new task" CTA;
 * everyone else just sees the list and clicks through to the detail
 * page (where the per-row annotate links live).
 *
 * For agent-trace-eval workspaces the tasks list still renders, but
 * the per-task detail page redirects to the trajectories surface
 * (trajectory mode doesn't have a topic-management UI here).
 */
export default async function WorkspaceTasksPage(props: {
  params: Promise<{ id: string }>
}) {
  const { id: workspaceId } = await props.params

  const me = await optionalUser()
  if (!me) {
    redirect(`/signin?next=/workspaces/${workspaceId}/tasks`)
  }
  let viewerRole: 'admin' | 'qc' | 'annotator' | 'viewer'
  try {
    const m = await requireWorkspaceMember(workspaceId)
    viewerRole = m.role
  } catch {
    notFound()
  }

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  const tasks = await listTasksInWorkspace(workspaceId)

  // Topic counts per task — single grouped query so the list scales.
  const db = getDb()
  const taskIds = tasks.map((t) => t.id)
  const counts =
    taskIds.length > 0
      ? await db
          .select({
            taskId: topics.taskId,
            n: sql<number>`count(*)::int`,
          })
          .from(topics)
          .where(
            taskIds.length === 1
              ? eq(topics.taskId, taskIds[0])
              : inArray(topics.taskId, taskIds),
          )
          .groupBy(topics.taskId)
      : []
  const countByTask = new Map<string, number>(
    counts.map((c) => [c.taskId, Number(c.n)]),
  )

  const isAdmin = viewerRole === 'admin'

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <div className="flex items-center gap-3 ts-12 mono mb-3">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="hover:underline"
          style={{ color: 'var(--mute)' }}
        >
          {workspace.name}
        </Link>
        <span style={{ color: 'var(--mute2)' }}>·</span>
        <span style={{ color: 'var(--text)' }}>tasks</span>
      </div>

      <div className="flex items-baseline justify-between mb-6">
        <h1
          className="ts-22"
          style={{ color: 'var(--hi)', fontWeight: 600 }}
        >
          Tasks
        </h1>
        {isAdmin && (
          <Link
            href={`/workspaces/${workspaceId}/tasks/new`}
            className="ts-13 mono"
            style={{
              background: 'var(--accent)',
              color: 'white',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              padding: '6px 14px',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            + new task
          </Link>
        )}
      </div>

      {tasks.length === 0 ? (
        <EmptyTasksCard
          workspaceId={workspaceId}
          templateMode={workspace.templateMode}
          isAdmin={isAdmin}
        />
      ) : (
        <div
          className="rounded-md overflow-hidden"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          <table className="w-full ts-13">
            <thead>
              <tr
                style={{
                  background: 'var(--panel2)',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <th
                  className="text-left px-4 py-2 mono ts-11"
                  style={{ color: 'var(--mute)' }}
                >
                  TASK
                </th>
                <th
                  className="text-left px-4 py-2 mono ts-11"
                  style={{ color: 'var(--mute)', width: 160 }}
                >
                  MODE
                </th>
                <th
                  className="px-4 py-2 mono ts-11 text-center"
                  style={{ color: 'var(--mute)', width: 80 }}
                >
                  STATUS
                </th>
                <th
                  className="px-4 py-2 mono ts-11 text-center"
                  style={{ color: 'var(--mute)', width: 80 }}
                >
                  TOPICS
                </th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {tasks.map((task, idx) => (
                <tr
                  key={task.id}
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                  }}
                >
                  <td className="px-4 py-3" style={{ color: 'var(--text)' }}>
                    <div style={{ fontWeight: 500 }}>{task.name}</div>
                    {task.description && (
                      <div
                        className="ts-12 mt-0.5"
                        style={{ color: 'var(--mute2)' }}
                      >
                        {task.description.slice(0, 120)}
                      </div>
                    )}
                  </td>
                  <td
                    className="px-4 py-3 mono ts-12"
                    style={{ color: 'var(--mute)' }}
                  >
                    {task.templateMode}
                  </td>
                  <td
                    className="px-4 py-3 mono ts-12 text-center"
                    style={{ color: 'var(--mute)' }}
                  >
                    {task.status}
                  </td>
                  <td
                    className="px-4 py-3 mono ts-12 text-center"
                    style={{ color: 'var(--text)' }}
                  >
                    {countByTask.get(task.id) ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/workspaces/${workspaceId}/tasks/${task.id}`}
                      className="ts-12 mono"
                      style={{
                        color: 'var(--accent)',
                        textDecoration: 'none',
                      }}
                    >
                      open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * Empty-state CTA card (Phase-17 17a). Replaces the prior flat
 * "No tasks yet" sentence with a centered card that points the
 * admin at the right next-step button based on the workspace's
 * template mode — trajectory workspaces should usually capture
 * before they author a task, while pair/arena workspaces start
 * with a task.
 */
function EmptyTasksCard({
  workspaceId,
  templateMode,
  isAdmin,
}: {
  workspaceId: string
  templateMode: string
  isAdmin: boolean
}) {
  return (
    <div
      className="rounded-md px-6 py-10 text-center"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line)',
      }}
    >
      <div
        className="ts-22"
        style={{ color: 'var(--hi)', fontWeight: 500 }}
      >
        No tasks here yet
      </div>
      <p
        className="ts-13 mt-2 mx-auto"
        style={{ color: 'var(--mute)', maxWidth: 440 }}
      >
        Tasks are the publishable unit of work. Each one carries a
        rubric, a reward config, and a queue of topics for annotators
        to claim.
      </p>
      {isAdmin ? (
        <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
          <Link
            href={`/workspaces/${workspaceId}/tasks/new`}
            className="ts-13 mono"
            style={{
              background: 'var(--accent)',
              color: 'white',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              padding: '8px 16px',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            ▶ Create your first task
          </Link>
          {templateMode === 'agent-trace-eval' && (
            <Link
              href={`/workspaces/${workspaceId}/trajectories`}
              className="ts-13 mono"
              style={{
                color: 'var(--accent)',
                textDecoration: 'none',
              }}
            >
              Or capture a trajectory first →
            </Link>
          )}
        </div>
      ) : (
        <p
          className="ts-12 mt-4"
          style={{ color: 'var(--mute2)' }}
        >
          Workspace admins create tasks. Ping yours to publish one.
        </p>
      )}
    </div>
  )
}
