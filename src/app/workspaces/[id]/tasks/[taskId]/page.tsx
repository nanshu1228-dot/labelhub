import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  Archive,
  ArrowLeft,
  Bot,
  BookOpen,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Download,
  ExternalLink,
  Flag,
  ListChecks,
  PackagePlus,
  Pencil,
  Play,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'
import {
  optionalUser,
  requireWorkspaceMember,
} from '@/lib/auth/guards'
import {
  listTaskExportJobs,
  type TaskExportHistoryRow,
} from '@/lib/queries/export-jobs'
import { getTaskById, getTaskState } from '@/lib/queries/tasks'
import { listTopicsInTask } from '@/lib/queries/topics'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getEffectiveTemplate } from '@/lib/templates/effective'
import {
  formatDistributionStrategy,
  readTaskOperationalSettings,
  type TaskOperationalSettings,
} from '@/lib/tasks/settings'
import '@/lib/templates/init'
import { AddTopicForm } from '@/components/task-admin/add-topic-form'
import { ArchiveTaskButton } from '@/components/task-admin/archive-task-button'
import { BulkUploadForm } from '@/components/task-admin/bulk-upload-form'
import { TaskExportHistory } from '@/components/export/task-export-history'
import { TaskExportBuilder } from '@/components/task-admin/task-export-builder'
import { TaskLifecycleActions } from '@/components/task-admin/publish-task-button'
import { TopicRosterManager } from '@/components/task-admin/topic-roster-manager'
import type { TemplateMode } from '@/lib/templates/types'

export const metadata: Metadata = {
  title: 'Task — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/tasks/[taskId]
 *
 * Owner-facing task command center: dataset intake, publish state,
 * AI pre-review setup, review progress, and export entry points.
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

  if (task.templateMode === 'agent-trace-eval') {
    redirect(`/workspaces/${workspaceId}/trajectories`)
  }

  const [topics, taskState, exportHistory] = await Promise.all([
    listTopicsInTask(taskId, { limit: 200 }),
    getTaskState(taskId),
    listTaskExportJobs(taskId, { limit: 5 }),
  ])
  const topicStats = summarizeTopics(topics)
  const aiAgent = readAiAgentConfig(task.templateConfig)
  const taskSettings = readTaskOperationalSettings(task.templateConfig)
  const checklistOrDims =
    task.templateMode === 'pair-rubric'
      ? template.pairChecklist ?? []
      : template.arenaDimensions ?? []
  const checklistLabel =
    task.templateMode === 'pair-rubric'
      ? 'Rubric checks'
      : task.templateMode === 'arena-gsb'
        ? 'Scoring dimensions'
        : 'Template schema'
  const isAdmin = viewerRole === 'admin'
  const canInlineAddTopics =
    task.templateMode === 'pair-rubric' || task.templateMode === 'arena-gsb'
  const submittedOrReviewing =
    topicStats.submitted +
    topicStats.ai_review +
    topicStats.reviewing +
    topicStats.awaiting_acceptance

  return (
    <main
      className="min-h-screen px-4 py-6 sm:px-6 lg:px-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/workspaces/${workspaceId}/tasks`}
            className="ts-12 mono inline-flex items-center gap-2 rounded px-3"
            style={ghostButtonStyle}
          >
            <ArrowLeft size={14} />
            Tasks
          </Link>
          <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
            {workspace.name}
          </span>
        </div>

        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="lbl">OWNER TASK CONTROL</div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1
                className="ts-24"
                style={{ color: 'var(--hi)', fontWeight: 560 }}
              >
                {task.name}
              </h1>
              <TaskStatusBadge status={task.status} />
            </div>
            <p
              className="ts-13 mt-2 max-w-[760px]"
              style={{ color: 'var(--mute)' }}
            >
              {task.description ||
                'Manage data intake, publish readiness, review routing, and delivery from one task workspace.'}
            </p>
            {taskSettings.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {taskSettings.tags.map((tag) => (
                  <span
                    key={tag}
                    className="ts-11 mono rounded px-2 py-0.5"
                    style={{
                      background: 'var(--accent-soft)',
                      border: '1px solid var(--accent-line)',
                      color: 'var(--accent)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/workspaces/${workspaceId}/tasks/${taskId}/guidelines`}
              className="ts-12 mono inline-flex items-center gap-2 rounded px-3"
              style={ghostButtonStyle}
            >
              <BookOpen size={14} />
              Guidelines
            </Link>
            <Link
              href={`/workspaces/${workspaceId}/tasks/${taskId}/ai-agent`}
              className="ts-12 mono inline-flex items-center gap-2 rounded px-3"
              style={ghostButtonStyle}
            >
              <Bot size={14} />
              AI agent
            </Link>
            {isAdmin ? (
              <>
                {task.status !== 'archived' ? (
                  <Link
                    href={`/workspaces/${workspaceId}/tasks/${taskId}/edit`}
                    className="ts-12 mono inline-flex items-center gap-2 rounded px-3"
                    style={ghostButtonStyle}
                  >
                    <Pencil size={14} />
                    Edit
                  </Link>
                ) : null}
                <TaskLifecycleActions
                  taskId={taskId}
                  status={task.status}
                  publishDisabledReason={
                    topicStats.total === 0
                      ? 'Import at least one topic before publishing.'
                      : null
                  }
                />
                {task.status !== 'archived' ? (
                  <ArchiveTaskButton taskId={taskId} status={task.status} />
                ) : null}
              </>
            ) : null}
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <StatCard
            label="Task Status"
            value={formatTaskStatus(task.status)}
            icon={task.status === 'open' ? <Play size={17} /> : <ClipboardList size={17} />}
            tone={task.status === 'open' ? 'success' : 'accent'}
          />
          <StatCard
            label="Topics"
            value={String(topicStats.total)}
            icon={<PackagePlus size={17} />}
          />
          <StatCard
            label="In Review"
            value={String(submittedOrReviewing)}
            icon={<ShieldCheck size={17} />}
            tone="warning"
          />
          <StatCard
            label="Approved"
            value={`${topicStats.approved} / ${topicStats.total}`}
            icon={<CheckCircle2 size={17} />}
            tone="success"
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-6">
            {isAdmin ? (
              <section className="flex flex-col gap-3">
                <SectionHeader
                  label="DATASET INTAKE"
                  title="Import, add, and preview topics"
                  body="Use the import wizard for JSON / JSONL / CSV-shaped datasets, or add small batches directly while preparing a task."
                  action={
                    <Link
                      href={`/admin/tasks/${taskId}/import`}
                      className="ts-12 mono inline-flex items-center gap-2 rounded px-3"
                      style={primaryButtonStyle}
                    >
                      <UploadCloud size={14} />
                      Import wizard
                    </Link>
                  }
                />
                <BulkUploadForm taskId={taskId} />
                {canInlineAddTopics ? (
                  <AddTopicForm
                    workspaceId={workspaceId}
                    taskId={taskId}
                    templateMode={task.templateMode as TemplateMode}
                  />
                ) : (
                  <ImportOnlyPanel taskId={taskId} />
                )}
              </section>
            ) : null}

            <section
              className="rounded p-4"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
              }}
            >
              <SectionHeader
                label="TEMPLATE"
                title={checklistLabel}
                body={
                  task.templateConfig
                    ? 'This task has a custom configuration layered over the template defaults.'
                    : 'This task currently uses the template defaults.'
                }
              />
              {checklistOrDims.length > 0 ? (
                <div
                  className="mt-4"
                  style={{
                    overflowX: 'auto',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  <table
                    className="ts-13"
                    style={{
                      borderCollapse: 'separate',
                      borderSpacing: 0,
                      width: '100%',
                      minWidth: 640,
                    }}
                  >
                    <tbody>
                      {checklistOrDims.map((item, idx) => (
                        <tr key={item.id}>
                          <td
                            className="px-3 py-3 mono ts-12 align-top"
                            style={{
                              color: 'var(--mute2)',
                              width: 180,
                              borderTop:
                                idx === 0 ? 'none' : '1px solid var(--line)',
                            }}
                          >
                            {item.id}
                          </td>
                          <td
                            className="px-3 py-3 align-top"
                            style={{
                              color: 'var(--text)',
                              borderTop:
                                idx === 0 ? 'none' : '1px solid var(--line)',
                            }}
                          >
                            {item.name}
                          </td>
                          <td
                            className="px-3 py-3 ts-12 align-top"
                            style={{
                              color: 'var(--mute2)',
                              borderTop:
                                idx === 0 ? 'none' : '1px solid var(--line)',
                            }}
                          >
                            {item.description ?? ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div
                  className="mt-4 rounded p-5 ts-13"
                  style={{
                    background: 'var(--bg)',
                    border: '1px dashed var(--line2)',
                    color: 'var(--mute2)',
                  }}
                >
                  Custom form fields are managed in the Designer Library and
                  rendered from the linked schema at annotation time.
                </div>
              )}
            </section>

            <TopicRosterManager
              workspaceId={workspaceId}
              taskId={taskId}
              topics={topics}
              canReview={isAdmin || viewerRole === 'qc'}
              canManage={isAdmin}
            />
          </div>

          <aside className="flex flex-col gap-4">
            <OperationsPanel
              settings={taskSettings}
              importedCount={topicStats.total}
            />
            <LifecyclePanel
              status={task.status}
              createdAt={task.createdAt}
              publishedAt={taskState?.publishedAt ?? null}
              pausedAt={taskState?.pausedAt ?? null}
              closedAt={taskState?.closedAt ?? null}
              archivedAt={taskState?.archivedAt ?? null}
              topicStats={topicStats}
              aiAgent={aiAgent}
            />
            <DeliveryPanel
              workspaceId={workspaceId}
              taskId={taskId}
              exportHistory={exportHistory}
            />
            <WorkflowPanel
              taskId={taskId}
              workspaceId={workspaceId}
              aiAgent={aiAgent}
              reward={formatReward(task.rewardConfig)}
              deadline={task.deadline}
            />
          </aside>
        </div>
      </div>
    </main>
  )
}

function SectionHeader({
  label,
  title,
  body,
  action,
}: {
  label: string
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="lbl">{label}</div>
        <h2
          className="ts-16 mt-1"
          style={{ color: 'var(--hi)', fontWeight: 560 }}
        >
          {title}
        </h2>
        {body ? (
          <p className="ts-12 mt-1 max-w-[680px]" style={{ color: 'var(--mute2)' }}>
            {body}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

function ImportOnlyPanel({ taskId }: { taskId: string }) {
  return (
    <div
      className="rounded p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="inline-flex shrink-0 items-center justify-center rounded"
          style={{
            width: 36,
            height: 36,
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-line)',
          }}
        >
          <UploadCloud size={17} />
        </span>
        <div>
          <div className="ts-13" style={{ color: 'var(--text)', fontWeight: 600 }}>
            Use structured import for this template
          </div>
          <p className="ts-12 mt-1" style={{ color: 'var(--mute2)', lineHeight: 1.5 }}>
            Custom Designer tasks can accept arbitrary item payloads, so the
            import wizard is the safest path for schema-aligned datasets.
          </p>
          <Link
            href={`/admin/tasks/${taskId}/import`}
            className="ts-12 mono mt-3 inline-flex items-center gap-2 rounded px-3"
            style={ghostButtonStyle}
          >
            Open import wizard
            <ExternalLink size={13} />
          </Link>
        </div>
      </div>
    </div>
  )
}

function OperationsPanel({
  settings,
  importedCount,
}: {
  settings: TaskOperationalSettings
  importedCount: number
}) {
  const quota = settings.quotaTotal
  const quotaText = quota ? `${importedCount} / ${quota}` : 'Open'
  return (
    <Panel title="Task Rules" label="OPERATIONS" icon={<Flag size={16} />}>
      <div className="grid gap-2 ts-12 mono" style={{ color: 'var(--mute2)' }}>
        <Fact
          label="Distribution"
          value={formatDistributionStrategy(settings.distributionStrategy)}
        />
        <Fact label="Quota" value={quotaText} />
        <Fact
          label="Tags"
          value={settings.tags.length > 0 ? settings.tags.join(', ') : 'Not set'}
        />
      </div>
    </Panel>
  )
}

function LifecyclePanel({
  status,
  createdAt,
  publishedAt,
  pausedAt,
  closedAt,
  archivedAt,
  topicStats,
  aiAgent,
}: {
  status: string
  createdAt: Date
  publishedAt: Date | null
  pausedAt: Date | null
  closedAt: Date | null
  archivedAt: Date | null
  topicStats: TopicStats
  aiAgent: AiAgentSummary
}) {
  return (
    <Panel title="Publish Readiness" label="LIFECYCLE" icon={<ListChecks size={16} />}>
      <div className="flex flex-col gap-3">
        <ReadinessStep
          done={topicStats.total > 0}
          label="Dataset imported"
          body={`${topicStats.total} topic${topicStats.total === 1 ? '' : 's'} available for assignment.`}
        />
        <ReadinessStep
          done={status !== 'draft'}
          label="Task published"
          body={
            status === 'draft'
              ? 'Draft tasks stay hidden from the task square.'
              : `Current status is ${formatTaskStatus(status)}.`
          }
        />
        <ReadinessStep
          done={aiAgent.enabled}
          label="AI pre-review configured"
          body={
            aiAgent.enabled
              ? `${aiAgent.dimensionCount} scoring dimension${aiAgent.dimensionCount === 1 ? '' : 's'} · ${aiAgent.tier} tier.`
              : 'Configure the Agent before high-volume review.'
          }
        />
      </div>
      <div
        className="mt-4 grid gap-2 ts-12 mono"
        style={{ color: 'var(--mute2)' }}
      >
        <Fact label="Created" value={formatDate(createdAt)} />
        <Fact label="Published" value={formatLifecycleDate(status, 'open', publishedAt)} />
        <Fact label="Paused" value={formatLifecycleDate(status, 'paused', pausedAt)} />
        <Fact label="Closed" value={formatLifecycleDate(status, 'closed', closedAt)} />
        <Fact label="Archived" value={formatLifecycleDate(status, 'archived', archivedAt)} />
      </div>
    </Panel>
  )
}

function DeliveryPanel({
  workspaceId,
  taskId,
  exportHistory,
}: {
  workspaceId: string
  taskId: string
  exportHistory: TaskExportHistoryRow[]
}) {
  return (
    <Panel title="Delivery" label="EXPORT" icon={<Download size={16} />}>
      <TaskExportBuilder workspaceId={workspaceId} taskId={taskId} />
      <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
        <div className="lbl mb-2" style={{ color: 'var(--mute2)' }}>
          RECENT EXPORTS
        </div>
        <TaskExportHistory jobs={exportHistory} />
      </div>
    </Panel>
  )
}

function WorkflowPanel({
  workspaceId,
  taskId,
  aiAgent,
  reward,
  deadline,
}: {
  workspaceId: string
  taskId: string
  aiAgent: AiAgentSummary
  reward: string
  deadline: Date | null
}) {
  return (
    <Panel title="Routing" label="WORKFLOW" icon={<Flag size={16} />}>
      <div className="flex flex-col gap-2">
        <WorkflowLink
          href={`/workspaces/${workspaceId}/tasks/${taskId}/ai-agent`}
          icon={<Bot size={14} />}
          label={aiAgent.enabled ? 'AI pre-review enabled' : 'Configure AI pre-review'}
        />
        <WorkflowLink
          href="/review"
          icon={<ShieldCheck size={14} />}
          label="Human review queue"
        />
        <WorkflowLink
          href={`/workspaces/${workspaceId}/tasks/${taskId}/guidelines`}
          icon={<BookOpen size={14} />}
          label="Guidelines and refinements"
        />
      </div>
      <div className="mt-4 grid gap-2 ts-12 mono" style={{ color: 'var(--mute2)' }}>
        <Fact label="Reward" value={reward} />
        <Fact label="Deadline" value={deadline ? formatDate(deadline) : 'Not set'} />
      </div>
    </Panel>
  )
}

function Panel({
  label,
  title,
  icon,
  children,
}: {
  label: string
  title: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <section
      className="rounded p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="lbl">{label}</div>
          <h2
            className="ts-16 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 560 }}
          >
            {title}
          </h2>
        </div>
        <span style={{ color: 'var(--mute)' }}>{icon}</span>
      </div>
      {children}
    </section>
  )
}

function StatCard({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string
  value: string
  icon: ReactNode
  tone?: 'neutral' | 'accent' | 'success' | 'warning'
}) {
  const color =
    tone === 'accent'
      ? 'var(--accent)'
      : tone === 'success'
        ? 'oklch(0.62 0.16 145)'
        : tone === 'warning'
          ? 'var(--warn)'
          : 'var(--mute)'
  return (
    <div
      className="rounded p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        minHeight: 104,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="lh-mono lh-caption" style={{ color: 'var(--mute2)' }}>
          {label}
        </div>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="ts-24 mt-3" style={{ color: 'var(--hi)', fontWeight: 560 }}>
        {value}
      </div>
    </div>
  )
}

function ReadinessStep({
  done,
  label,
  body,
}: {
  done: boolean
  label: string
  body: string
}) {
  return (
    <div className="flex gap-3">
      <span
        className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded"
        style={{
          width: 24,
          height: 24,
          color: done ? 'oklch(0.62 0.16 145)' : 'var(--mute2)',
          background: done ? 'oklch(0.62 0.16 145 / 0.1)' : 'var(--panel2)',
          border: `1px solid ${done ? 'oklch(0.62 0.16 145 / 0.35)' : 'var(--line)'}`,
        }}
      >
        {done ? <CheckCircle2 size={14} /> : <CircleDot size={13} />}
      </span>
      <div>
        <div className="ts-13" style={{ color: 'var(--text)', fontWeight: 600 }}>
          {label}
        </div>
        <div className="ts-12 mt-0.5" style={{ color: 'var(--mute2)', lineHeight: 1.45 }}>
          {body}
        </div>
      </div>
    </div>
  )
}

function WorkflowLink({
  href,
  icon,
  label,
}: {
  href: string
  icon: ReactNode
  label: string
}) {
  return (
    <Link
      href={href}
      className="ts-12 mono inline-flex items-center justify-between gap-2 rounded px-3"
      style={ghostButtonStyle}
    >
      <span className="inline-flex items-center gap-2">
        {icon}
        {label}
      </span>
      <ExternalLink size={13} />
    </Link>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

function TaskStatusBadge({ status }: { status: string }) {
  const tone = statusTone(status)
  const Icon = status === 'archived' ? Archive : status === 'open' ? Play : ClipboardList
  return (
    <span
      className="ts-11 mono inline-flex items-center gap-1.5 rounded px-2 py-1"
      style={{
        color: tone.fg,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
      }}
    >
      <Icon size={13} />
      {formatTaskStatus(status)}
    </span>
  )
}

type TopicRow = Awaited<ReturnType<typeof listTopicsInTask>>[number]
type TopicStats = ReturnType<typeof summarizeTopics>
type AiAgentSummary = ReturnType<typeof readAiAgentConfig>

function summarizeTopics(topics: TopicRow[]) {
  const stats = {
    total: topics.length,
    drafting: 0,
    revising: 0,
    submitted: 0,
    ai_review: 0,
    reviewing: 0,
    awaiting_acceptance: 0,
    approved: 0,
    rejected: 0,
  }
  for (const topic of topics) {
    if (topic.status in stats) {
      stats[topic.status as keyof typeof stats] += 1
    }
  }
  return stats
}

function readAiAgentConfig(config: unknown) {
  const aiAgent =
    config && typeof config === 'object'
      ? (config as { aiAgent?: unknown }).aiAgent
      : null
  if (!aiAgent || typeof aiAgent !== 'object') {
    return { enabled: false, dimensionCount: 0, tier: 'fast' }
  }
  const raw = aiAgent as {
    enabled?: unknown
    dimensions?: unknown
    tier?: unknown
  }
  return {
    enabled: raw.enabled === true,
    dimensionCount: Array.isArray(raw.dimensions) ? raw.dimensions.length : 0,
    tier: typeof raw.tier === 'string' ? raw.tier : 'fast',
  }
}

function formatTaskStatus(status: string): string {
  if (status === 'open') return 'Published'
  if (status === 'draft') return 'Draft'
  if (status === 'paused') return 'Paused'
  if (status === 'closed') return 'Closed'
  if (status === 'archived') return 'Archived'
  return status
}

function statusTone(status: string) {
  if (status === 'open') {
    return {
      fg: 'oklch(0.62 0.16 145)',
      bg: 'oklch(0.62 0.16 145 / 0.08)',
      border: 'oklch(0.62 0.16 145 / 0.32)',
    }
  }
  if (status === 'archived' || status === 'closed') {
    return {
      fg: 'var(--mute2)',
      bg: 'var(--panel2)',
      border: 'var(--line)',
    }
  }
  return {
    fg: 'var(--accent)',
    bg: 'var(--accent-soft)',
    border: 'var(--accent-line)',
  }
}

function formatReward(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Configured'
  const reward = value as {
    currency?: string
    baseAmountMinor?: number
    amount?: number
    type?: string
  }
  const minor =
    typeof reward.baseAmountMinor === 'number'
      ? reward.baseAmountMinor
      : reward.amount
  if (typeof minor === 'number') {
    const currency = reward.currency ?? 'CNY'
    return `${currency} ${(minor / 100).toFixed(2)}`
  }
  return reward.type ?? 'Configured'
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function formatLifecycleDate(
  status: string,
  activeStatus: 'open' | 'paused' | 'closed' | 'archived',
  value: Date | null,
): string {
  if (value) return formatDate(value)
  if (status === activeStatus) return 'Status active'
  if (activeStatus === 'open') return 'Not published'
  if (activeStatus === 'paused') return 'Not paused'
  if (activeStatus === 'closed') return 'Not closed'
  return 'Not archived'
}

const primaryButtonStyle = {
  minHeight: 40,
  color: 'white',
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
  textDecoration: 'none',
  fontWeight: 600,
}

const ghostButtonStyle = {
  minHeight: 40,
  color: 'var(--text)',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  textDecoration: 'none',
}
