import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ClipboardCheck,
  Filter,
  Flag,
  Inbox,
  ListFilter,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import { optionalUser } from '@/lib/auth/guards'
import {
  listMyReviewableWorkspaces,
  listReviewableTasks,
  listReviewQueue,
  type ReviewQueueItem,
  type ReviewQueueStage,
} from '@/lib/queries/review-queue'
import { ReviewQueueTable } from '@/components/review/review-queue-table'
import { StatCard } from '@/components/ui/stat-card'

export const metadata: Metadata = {
  title: 'Review queue — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /review — reviewer-facing triage console.
 *
 * Lists submissions awaiting QC / admin review across every workspace
 * where the signed-in user has qc or admin access.
 */
export default async function ReviewQueuePage(props: {
  searchParams?: Promise<{
    workspaceId?: string
    stage?: string
    taskId?: string
    aiVerdict?: string
    submitterId?: string
  }>
}) {
  const me = await optionalUser()
  if (!me) redirect('/signin?next=/review')

  const reviewableWorkspaces = await listMyReviewableWorkspaces({ userId: me.id })
  if (reviewableWorkspaces.length === 0) notFound()

  const search = (await props.searchParams) ?? {}
  const stageFilter = matchStage(search.stage)
  const aiVerdictFilter = matchAiVerdict(search.aiVerdict)

  const [items, tasks] = await Promise.all([
    listReviewQueue({
      userId: me.id,
      workspaceId: search.workspaceId,
      stage: stageFilter,
      taskId: search.taskId,
      aiVerdict: aiVerdictFilter,
      submitterId: search.submitterId,
      limit: 100,
    }),
    listReviewableTasks(me.id),
  ])

  const stats = summarizeQueue(items)
  const hasFilters = Boolean(search.workspaceId || stageFilter || search.taskId || aiVerdictFilter)

  return (
    <main
      className="min-h-screen px-4 py-6 sm:px-6 lg:px-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="lbl">REVIEW TRIAGE</div>
            <h1
              className="ts-24 mt-2"
              style={{ color: 'var(--hi)', fontWeight: 560 }}
            >
              Review queue
            </h1>
            <p className="ts-13 mt-1 max-w-[720px]" style={{ color: 'var(--mute)' }}>
              Prioritize AI-flagged submissions, batch routine decisions,
              and open detailed cases for human judgment.
            </p>
          </div>
          <Link
            href="/my/tasks"
            className="lh-btn lh-btn-ghost"
            style={{ textDecoration: 'none' }}
          >
            <Inbox size={16} />
            My tasks
          </Link>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <StatCard label="Awaiting" value={String(items.length)} icon={<ClipboardCheck size={17} />} />
          <StatCard label="AI Priority" value={String(stats.priority)} icon={<Flag size={17} />} tone="warn" />
          <StatCard label="Human Review" value={String(stats.humanReview)} icon={<ShieldCheck size={17} />} tone="accent" />
          <StatCard label="Final Accept" value={String(stats.awaitingAcceptance)} icon={<RotateCcw size={17} />} tone="warn" />
        </section>

        <section
          className="rounded p-4"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="lbl">QUEUE FILTERS</div>
              <h2
                className="ts-16 mt-1"
                style={{ color: 'var(--hi)', fontWeight: 560 }}
              >
                Triage scope
              </h2>
            </div>
            {hasFilters ? (
              <Link
                href="/review"
                className="lh-btn lh-btn-ghost lh-btn-sm"
                style={{ textDecoration: 'none' }}
              >
                <ListFilter size={14} />
                Clear filters
              </Link>
            ) : null}
          </div>

          <FilterRow
            workspaces={reviewableWorkspaces}
            tasks={tasks}
            active={{
              workspaceId: search.workspaceId,
              stage: stageFilter,
              taskId: search.taskId,
              aiVerdict: aiVerdictFilter,
            }}
          />
        </section>

        <section
          className="rounded p-4"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="lbl">SUBMISSIONS</div>
              <h2
                className="ts-16 mt-1"
                style={{ color: 'var(--hi)', fontWeight: 560 }}
              >
                Cases awaiting review
              </h2>
            </div>
            <div className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
              {items.length === 0
                ? 'Queue clear'
                : `${items.length} item${items.length === 1 ? '' : 's'}`}
            </div>
          </div>

          {items.length === 0 ? <EmptyState /> : <ReviewQueueTable items={items} />}
        </section>
      </div>
    </main>
  )
}

function matchStage(
  s?: string,
): ReviewQueueStage | undefined {
  if (
    s === 'submitted' ||
    s === 'ai_review' ||
    s === 'reviewing' ||
    s === 'awaiting_acceptance'
  ) {
    return s
  }
  return undefined
}

function matchAiVerdict(
  v?: string,
): 'pass' | 'send_back' | 'human_review' | 'pending' | undefined {
  if (
    v === 'pass' ||
    v === 'send_back' ||
    v === 'human_review' ||
    v === 'pending'
  ) {
    return v
  }
  return undefined
}

function FilterRow({
  workspaces,
  tasks,
  active,
}: {
  workspaces: Array<{ workspaceId: string; workspaceName: string }>
  tasks: Array<{
    taskId: string
    taskName: string
    workspaceId: string
    workspaceName: string
  }>
  active: {
    workspaceId?: string
    stage?: ReviewQueueStage
    taskId?: string
    aiVerdict?: 'pass' | 'send_back' | 'human_review' | 'pending'
  }
}) {
  function href(patch: Partial<typeof active>) {
    const merged = { ...active, ...patch }
    const params = new URLSearchParams()
    if (merged.workspaceId) params.set('workspaceId', merged.workspaceId)
    if (merged.stage) params.set('stage', merged.stage)
    if (merged.taskId) params.set('taskId', merged.taskId)
    if (merged.aiVerdict) params.set('aiVerdict', merged.aiVerdict)
    return params.toString() ? `/review?${params}` : '/review'
  }

  const visibleTasks = active.workspaceId
    ? tasks.filter((t) => t.workspaceId === active.workspaceId)
    : tasks

  return (
    <div className="flex flex-col gap-3">
      <FilterGroup label="WORKSPACE">
        <FilterChip href={href({ workspaceId: undefined })} active={!active.workspaceId}>
          All
        </FilterChip>
        {workspaces.map((w) => (
          <FilterChip
            key={w.workspaceId}
            href={href({ workspaceId: w.workspaceId })}
            active={active.workspaceId === w.workspaceId}
          >
            {w.workspaceName}
          </FilterChip>
        ))}
      </FilterGroup>

      <FilterGroup label="STAGE">
        <FilterChip href={href({ stage: undefined })} active={!active.stage}>
          All
        </FilterChip>
        {(['submitted', 'ai_review', 'reviewing', 'awaiting_acceptance'] as const).map((stage) => (
          <FilterChip
            key={stage}
            href={href({ stage })}
            active={active.stage === stage}
          >
            {formatStageLabel(stage)}
          </FilterChip>
        ))}
      </FilterGroup>

      <FilterGroup label="AI VERDICT">
        <FilterChip href={href({ aiVerdict: undefined })} active={!active.aiVerdict}>
          All
        </FilterChip>
        {(['pass', 'send_back', 'human_review', 'pending'] as const).map((verdict) => (
          <FilterChip
            key={verdict}
            href={href({ aiVerdict: verdict })}
            active={active.aiVerdict === verdict}
          >
            {formatAiVerdictLabel(verdict)}
          </FilterChip>
        ))}
      </FilterGroup>

      {visibleTasks.length > 0 ? (
        <FilterGroup label="TASK">
          <FilterChip href={href({ taskId: undefined })} active={!active.taskId}>
            All
          </FilterChip>
          {visibleTasks.slice(0, 12).map((task) => (
            <FilterChip
              key={task.taskId}
              href={href({ taskId: task.taskId })}
              active={active.taskId === task.taskId}
            >
              {task.taskName}
            </FilterChip>
          ))}
          {visibleTasks.length > 12 ? (
            <span className="ts-11" style={{ color: 'var(--mute2)' }}>
              {visibleTasks.length - 12} more
            </span>
          ) : null}
        </FilterGroup>
      ) : null}
    </div>
  )
}

function FilterGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[100px_minmax(0,1fr)] sm:items-start">
      <span className="ts-11 mono pt-2" style={{ color: 'var(--mute2)' }}>
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className="ts-12 mono px-3 rounded inline-flex items-center gap-2"
      style={{
        minHeight: 36,
        background: active ? 'var(--accent-soft)' : 'var(--bg)',
        border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
        color: active ? 'var(--accent)' : 'var(--text)',
        textDecoration: 'none',
      }}
    >
      {active ? <Filter size={13} /> : null}
      {children}
    </Link>
  )
}

function EmptyState() {
  return (
    <div
      className="rounded p-10 text-center ts-13"
      style={{
        background: 'var(--bg)',
        border: '1px dashed var(--line2)',
        color: 'var(--mute2)',
      }}
    >
      <div
        className="mx-auto mb-3 inline-flex items-center justify-center rounded"
        style={{
          width: 40,
          height: 40,
          background: 'var(--panel2)',
          border: '1px solid var(--line)',
          color: 'var(--mute)',
        }}
      >
        <Inbox size={18} />
      </div>
      <div>No submissions match these filters.</div>
      <div className="mt-1">Try clearing filters or come back after a Labeler submits.</div>
    </div>
  )
}

function formatStageLabel(stage: ReviewQueueStage): string {
  if (stage === 'ai_review') return 'AI review'
  if (stage === 'reviewing') return 'Reviewing'
  if (stage === 'awaiting_acceptance') return 'Final accept'
  return 'Submitted'
}

function formatAiVerdictLabel(
  verdict: 'pass' | 'send_back' | 'human_review' | 'pending',
): string {
  if (verdict === 'send_back') return 'Send back'
  if (verdict === 'human_review') return 'Human review'
  if (verdict === 'pending') return 'Pending'
  return 'Pass'
}

function summarizeQueue(items: ReviewQueueItem[]) {
  return items.reduce(
    (acc, item) => {
      if (item.aiPriority) acc.priority += 1
      if (item.aiVerdict === 'human_review') acc.humanReview += 1
      if (item.aiVerdict === 'send_back') acc.sendBack += 1
      if (item.aiStatus === 'pending') acc.pendingAi += 1
      if (item.status === 'awaiting_acceptance') acc.awaitingAcceptance += 1
      return acc
    },
    {
      priority: 0,
      humanReview: 0,
      sendBack: 0,
      pendingAi: 0,
      awaitingAcceptance: 0,
    },
  )
}
