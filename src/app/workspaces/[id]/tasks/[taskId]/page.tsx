import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  optionalUser,
  requireWorkspaceMember,
} from '@/lib/auth/guards'
import { getTaskById } from '@/lib/queries/tasks'
import { listTopicsInTask } from '@/lib/queries/topics'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getEffectiveTemplate } from '@/lib/templates/effective'
import '@/lib/templates/init'
import { AddTopicForm } from '@/components/task-admin/add-topic-form'
import { BulkUploadForm } from '@/components/task-admin/bulk-upload-form'
import { PublishTaskButton } from '@/components/task-admin/publish-task-button'
import type { TemplateMode } from '@/lib/templates/types'

export const metadata: Metadata = {
  title: 'Task — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/tasks/[taskId]
 *
 * The admin's home for one task — header, the rubric/dimensions list
 * being used, and the topics roster. Admin can add new topics inline
 * (one prompt+A+B at a time); annotators see the topics list with
 * "annotate" links per row.
 *
 * Access: workspace member sees the page; only admin sees the
 * AddTopicForm and the topic-management controls.
 */
export default async function TaskDetailPage(props: {
  params: Promise<{ id: string; taskId: string }>
}) {
  const { id: workspaceId, taskId } = await props.params

  const me = await optionalUser()
  if (!me) {
    redirect(
      `/signin?next=/workspaces/${workspaceId}/tasks/${taskId}`,
    )
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
  const task = await getTaskById(taskId)
  if (!task || task.workspaceId !== workspaceId) notFound()

  const template = getEffectiveTemplate(task.templateMode, task.templateConfig)
  if (!template) {
    throw new Error(
      `Task uses templateMode "${task.templateMode}" which is not registered.`,
    )
  }

  // Trajectory mode hands the user off — there's no per-task topic
  // management UI for traces (they're auto-materialized from captures).
  if (task.templateMode === 'agent-trace-eval') {
    redirect(`/workspaces/${workspaceId}/trajectories`)
  }

  const topics = await listTopicsInTask(taskId, { limit: 200 })
  const checklistOrDims =
    task.templateMode === 'pair-rubric'
      ? template.pairChecklist ?? []
      : template.arenaDimensions ?? []
  const checklistLabel =
    task.templateMode === 'pair-rubric'
      ? 'rubric items (yes/no)'
      : 'dimensions (1–5)'
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
        <span style={{ color: 'var(--text)' }}>{task.name}</span>
        <span
          className="ts-11 mono ml-auto px-2 py-0.5 rounded"
          style={{
            color: 'var(--accent)',
            background: 'oklch(0.6 0.18 280 / 0.1)',
            border: '1px solid oklch(0.6 0.18 280 / 0.25)',
            letterSpacing: '0.06em',
          }}
        >
          {task.templateMode.toUpperCase()}
        </span>
      </div>

      <header className="mb-6">
        <h1
          className="ts-22 mb-2"
          style={{ color: 'var(--hi)', fontWeight: 600 }}
        >
          {task.name}
        </h1>
        {task.description && (
          <p className="ts-13" style={{ color: 'var(--mute)' }}>
            {task.description}
          </p>
        )}
        <div className="flex items-center gap-4 mt-3 ts-12 mono flex-wrap">
          <span style={{ color: 'var(--mute2)' }}>
            status{' '}
            <span style={{ color: 'var(--text)' }}>{task.status}</span>
          </span>
          <span style={{ color: 'var(--mute2)' }}>
            topics{' '}
            <span style={{ color: 'var(--text)' }}>{topics.length}</span>
          </span>
          <Link
            href={`/workspaces/${workspaceId}/tasks/${taskId}/guidelines`}
            className="ts-12 mono"
            style={{
              color: 'var(--accent)',
              textDecoration: 'none',
            }}
          >
            guidelines →
          </Link>
          {isAdmin && (
            <span className="ml-auto flex items-center gap-2">
              <a
                href={`/api/workspaces/${workspaceId}/tasks/${taskId}/export?format=json`}
                className="ts-12 mono"
                style={{
                  background: 'transparent',
                  color: 'var(--mute)',
                  border: '1px solid var(--line)',
                  borderRadius: 5,
                  padding: '4px 10px',
                  textDecoration: 'none',
                }}
                title="Download all submitted annotations as JSON"
              >
                ↓ json
              </a>
              <a
                href={`/api/workspaces/${workspaceId}/tasks/${taskId}/export?format=csv`}
                className="ts-12 mono"
                style={{
                  background: 'transparent',
                  color: 'var(--mute)',
                  border: '1px solid var(--line)',
                  borderRadius: 5,
                  padding: '4px 10px',
                  textDecoration: 'none',
                }}
                title="Download all submitted annotations as CSV"
              >
                ↓ csv
              </a>
              <PublishTaskButton taskId={taskId} status={task.status} />
            </span>
          )}
        </div>
      </header>

      <section className="mb-8">
        <div className="lbl mb-2">§ {checklistLabel.toUpperCase()}</div>
        <div
          className="rounded-md overflow-hidden"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          <table className="w-full ts-13">
            <tbody>
              {checklistOrDims.map((item, idx) => (
                <tr
                  key={item.id}
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                  }}
                >
                  <td
                    className="px-4 py-2 mono ts-12"
                    style={{
                      color: 'var(--mute2)',
                      width: 180,
                    }}
                  >
                    {item.id}
                  </td>
                  <td className="px-4 py-2" style={{ color: 'var(--text)' }}>
                    {item.name}
                  </td>
                  <td
                    className="px-4 py-2 ts-12"
                    style={{ color: 'var(--mute2)' }}
                  >
                    {item.description ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {task.templateConfig ? (
          <p
            className="ts-11 mono mt-2"
            style={{ color: 'var(--mute2)' }}
          >
            custom configuration · overrides the template defaults
          </p>
        ) : (
          <p
            className="ts-11 mono mt-2"
            style={{ color: 'var(--mute2)' }}
          >
            using template defaults
          </p>
        )}
      </section>

      {isAdmin && (
        <section className="mb-8">
          <div className="flex items-baseline justify-between mb-2">
            <div className="lbl">§ ADD A TOPIC</div>
            <BulkUploadForm taskId={taskId} />
          </div>
          <AddTopicForm
            workspaceId={workspaceId}
            taskId={taskId}
            templateMode={task.templateMode as TemplateMode}
          />
        </section>
      )}

      <section>
        <div className="flex items-baseline justify-between mb-2">
          <div className="lbl">§ TOPICS</div>
          <span
            className="ts-11 mono"
            style={{ color: 'var(--mute2)' }}
          >
            {topics.length} total
          </span>
        </div>
        {topics.length === 0 ? (
          <div
            className="rounded-md px-4 py-8 text-center ts-13 mono"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              color: 'var(--mute2)',
            }}
          >
            No topics yet.
            {isAdmin && ' Use the form above to add one.'}
          </div>
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
                    PROMPT (preview)
                  </th>
                  <th
                    className="px-4 py-2 mono ts-11"
                    style={{ color: 'var(--mute)', width: 120 }}
                  >
                    STATUS
                  </th>
                  <th style={{ width: 120 }} />
                </tr>
              </thead>
              <tbody>
                {topics.map((topic, idx) => {
                  const data = topic.itemData as { prompt?: unknown }
                  const prompt =
                    typeof data.prompt === 'string'
                      ? data.prompt
                      : '(no prompt)'
                  return (
                    <tr
                      key={topic.id}
                      style={{
                        borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                      }}
                    >
                      <td
                        className="px-4 py-3"
                        style={{
                          color: 'var(--text)',
                          maxWidth: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {prompt.slice(0, 100)}
                      </td>
                      <td
                        className="px-4 py-3 mono ts-12 text-center"
                        style={{ color: 'var(--mute)' }}
                      >
                        {topic.status}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/workspaces/${workspaceId}/topics/${topic.id}/annotate`}
                          className="ts-12 mono"
                          style={{
                            color: 'var(--accent)',
                            textDecoration: 'none',
                          }}
                        >
                          annotate →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
