import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import {
  listMyReviewableWorkspaces,
  listReviewableTasks,
  listReviewQueue,
  type ReviewQueueItem,
} from '@/lib/queries/review-queue'
import { ReviewQueueTable } from '@/components/review/review-queue-table'

export const metadata: Metadata = {
  title: 'Review queue — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /review — Finals P3 D11.
 *
 * Reviewer-facing queue across every workspace this user has the
 * qc or admin role in. Filters surface as query params so each
 * combination is shareable (and the page is SSR for fresh data).
 *
 * Non-reviewers get 404 — the surface is invisible to annotators.
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

  // Group by workspace for the filter chip-row.
  return (
    <main
      className="min-h-screen p-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <header className="flex items-baseline justify-between mb-6">
        <div>
          <div className="lbl" style={{ color: 'var(--mute)' }}>
            § REVIEW
          </div>
          <h1
            className="ts-22 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            Review queue
          </h1>
          <p className="ts-12 mt-1" style={{ color: 'var(--mute2)' }}>
            {items.length === 0
              ? 'Queue is clear. New submissions land here for QC + admin review.'
              : `${items.length} item${items.length === 1 ? '' : 's'} awaiting review · AI-priority items at the top`}
          </p>
        </div>
      </header>

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

      <section className="mt-6">
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          <ReviewQueueTable items={items} />
        )}
      </section>
    </main>
  )
}

function matchStage(s?: string): ReturnType<typeof passThrough> {
  if (s === 'submitted' || s === 'ai_review' || s === 'reviewing') return s
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
  )
    return v
  return undefined
}
function passThrough(): 'submitted' | 'ai_review' | 'reviewing' | undefined {
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
    stage?: 'submitted' | 'ai_review' | 'reviewing'
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

  // Filter task list to the active workspace if one is picked.
  const visibleTasks = active.workspaceId
    ? tasks.filter((t) => t.workspaceId === active.workspaceId)
    : tasks

  return (
    <div className="flex flex-col gap-2">
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
        {(['submitted', 'ai_review', 'reviewing'] as const).map((s) => (
          <FilterChip
            key={s}
            href={href({ stage: s })}
            active={active.stage === s}
          >
            {s}
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup label="AI VERDICT">
        <FilterChip href={href({ aiVerdict: undefined })} active={!active.aiVerdict}>
          All
        </FilterChip>
        {(['pass', 'send_back', 'human_review', 'pending'] as const).map((v) => (
          <FilterChip
            key={v}
            href={href({ aiVerdict: v })}
            active={active.aiVerdict === v}
          >
            {v}
          </FilterChip>
        ))}
      </FilterGroup>
      {visibleTasks.length > 0 && (
        <FilterGroup label="TASK">
          <FilterChip href={href({ taskId: undefined })} active={!active.taskId}>
            All
          </FilterChip>
          {visibleTasks.slice(0, 12).map((t) => (
            <FilterChip
              key={t.taskId}
              href={href({ taskId: t.taskId })}
              active={active.taskId === t.taskId}
            >
              {t.taskName}
            </FilterChip>
          ))}
          {visibleTasks.length > 12 ? (
            <span className="ts-11" style={{ color: 'var(--mute2)' }}>
              … {visibleTasks.length - 12} more
            </span>
          ) : null}
        </FilterGroup>
      )}
    </div>
  )
}

function FilterGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span
        className="ts-11 mono"
        style={{ color: 'var(--mute2)', minWidth: 90 }}
      >
        {label}
      </span>
      {children}
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
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="ts-12 mono px-3 rounded inline-flex items-center"
      style={{
        minHeight: 36,
        background: active ? 'var(--accent-soft)' : 'var(--panel2)',
        border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
        color: 'var(--text)',
        textDecoration: 'none',
      }}
    >
      {children}
    </Link>
  )
}

function EmptyState() {
  return (
    <div
      className="rounded-md p-12 text-center ts-13 mt-4"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line)',
        color: 'var(--mute2)',
      }}
    >
      No submissions match these filters. Try clearing them or come back
      after a Labeler submits.
    </div>
  )
}

export type { ReviewQueueItem }
