import type { CSSProperties, ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Flame,
  Flag,
  ListChecks,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
} from 'lucide-react'
import { optionalUser } from '@/lib/auth/guards'
import {
  getMyTaskDetail,
  type MyTaskTopicRow,
} from '@/lib/queries/my-tasks'
import { StatCard } from '@/components/ui/stat-card'

export const metadata: Metadata = {
  title: 'Task — LabelHub',
}

export const dynamic = 'force-dynamic'

type TopicFilter = 'all' | 'fresh' | 'mine' | 'revision' | 'submitted'

/**
 * /my/tasks/[taskId] — labeler-facing drill-down for one campaign.
 *
 * This is the handoff between task square and annotation workbench:
 * resume revisions/drafts first, then claim the highest-value fresh row.
 */
export default async function MyTaskDetailPage(props: {
  params: Promise<{ taskId: string }>
  searchParams?: Promise<{ filter?: string }>
}) {
  const { taskId } = await props.params
  const search = (await props.searchParams) ?? {}
  const filter = normalizeFilter(search.filter)

  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/my/tasks/${taskId}`)

  const detail = await getMyTaskDetail({ userId: me.id, taskId })
  if (!detail) notFound()

  const visible =
    filter === 'all'
      ? detail.topics
      : detail.topics.filter((t) => t.state === filter)

  const dueText = detail.task.deadline
    ? formatDeadline(detail.task.deadline)
    : null
  const nextTopic =
    detail.topics.find((t) => t.state === 'revision') ??
    detail.topics.find((t) => t.state === 'mine') ??
    detail.topics.find((t) => t.state === 'fresh') ??
    null
  const completed = detail.counts.submitted
  const actionable =
    detail.counts.revision + detail.counts.mine + detail.counts.fresh

  return (
    <main
      className="app-light min-h-screen px-4 py-6 sm:px-6 lg:px-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/my/tasks"
            className="ts-12 mono inline-flex items-center gap-2 rounded px-3"
            style={ghostButtonStyle}
          >
            <ArrowLeft size={14} />
            Task square
          </Link>
          <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
            {detail.task.workspaceName}
          </span>
        </div>

        <header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
          <div className="min-w-0">
            <div className="lbl">LABELER TASK ROOM</div>
            <h1
              className="ts-24 mt-2"
              style={{ color: 'var(--hi)', fontWeight: 560 }}
            >
              {detail.task.name}
            </h1>
            <p
              className="ts-13 mt-2 max-w-[780px]"
              style={{ color: 'var(--mute)' }}
            >
              {detail.task.description ||
                'Pick up rows, resume saved work, and revise anything sent back by AI or a reviewer.'}
            </p>
          </div>

          <NextWorkCard
            topic={nextTopic}
            workspaceId={detail.task.workspaceId}
          />
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <StatCard
            label="Actionable"
            value={String(actionable)}
            icon={<Play size={17} />}
            tone={actionable > 0 ? 'accent' : 'default'}
          />
          <StatCard
            label="Needs Revision"
            value={String(detail.counts.revision)}
            icon={<RotateCcw size={17} />}
            tone={detail.counts.revision > 0 ? 'warn' : 'default'}
          />
          <StatCard
            label="Submitted"
            value={String(completed)}
            icon={<CheckCircle2 size={17} />}
            tone="success"
          />
          <StatCard
            label="Reward"
            value={formatReward(detail.task.rewardPerTopic, detail.task.currency)}
            icon={<Wallet size={17} />}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-6">
            <section
              className="rounded p-4"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
              }}
            >
              <SectionHeader
                label="QUEUE"
                title="Pick your next item"
                body="Revisions are shown first, then saved drafts, then fresh topics ordered by active-learning signal when available."
                action={
                  <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
                    {visible.length} visible
                  </span>
                }
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <FilterChip
                  href={`/my/tasks/${taskId}`}
                  active={filter === 'all'}
                  label="All"
                  count={detail.topics.length}
                />
                <FilterChip
                  href={`/my/tasks/${taskId}?filter=revision`}
                  active={filter === 'revision'}
                  label="Needs revision"
                  count={detail.counts.revision}
                  tone="warning"
                />
                <FilterChip
                  href={`/my/tasks/${taskId}?filter=mine`}
                  active={filter === 'mine'}
                  label="My drafts"
                  count={detail.counts.mine}
                  tone="accent"
                />
                <FilterChip
                  href={`/my/tasks/${taskId}?filter=fresh`}
                  active={filter === 'fresh'}
                  label="Claimable"
                  count={detail.counts.fresh}
                  tone="success"
                />
                <FilterChip
                  href={`/my/tasks/${taskId}?filter=submitted`}
                  active={filter === 'submitted'}
                  label="Submitted"
                  count={detail.counts.submitted}
                  tone="muted"
                />
              </div>

              <ActiveLearningHint visible={visible} />

              {visible.length === 0 ? (
                <EmptyState filter={filter} />
              ) : (
                <ul className="mt-4 grid gap-2">
                  {visible.map((t) => (
                    <TopicRow
                      key={t.topicId}
                      topic={t}
                      workspaceId={detail.task.workspaceId}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="flex flex-col gap-4">
            <TaskContext
              mode={detail.task.templateMode}
              dueText={dueText}
              total={detail.topics.length}
              counts={detail.counts}
            />
            <GuidelinesPanel text={detail.task.guidelinesMarkdown} />
            <WorkflowPanel />
          </aside>
        </div>
      </div>
    </main>
  )
}

function NextWorkCard({
  topic,
  workspaceId,
}: {
  topic: MyTaskTopicRow | null
  workspaceId: string
}) {
  if (!topic) {
    return (
      <section
        className="rounded p-4"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <div className="lbl">NEXT UP</div>
        <div className="ts-16 mt-1" style={{ color: 'var(--hi)', fontWeight: 560 }}>
          Queue clear
        </div>
        <p className="ts-12 mt-1" style={{ color: 'var(--mute2)' }}>
          No claimable, draft, or revision rows are waiting in this task.
        </p>
      </section>
    )
  }

  return (
    <section
      className="rounded p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="lbl">NEXT UP</div>
          <div className="ts-16 mt-1" style={{ color: 'var(--hi)', fontWeight: 560 }}>
            {nextTopicTitle(topic.state)}
          </div>
        </div>
        <TopicStateBadge topic={topic} />
      </div>
      <p
        className="ts-12 mt-3"
        style={{
          color: 'var(--mute)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {topic.promptPreview}
      </p>
      {topic.reviewFeedback ? (
        <div
          className="ts-12 mt-3 rounded p-2"
          style={{
            color: 'var(--warn)',
            background: 'oklch(0.68 0.16 70 / 0.08)',
            border: '1px solid oklch(0.68 0.16 70 / 0.35)',
          }}
        >
          {topic.reviewFeedback}
        </div>
      ) : null}
      <Link
        href={`/workspaces/${workspaceId}/topics/${topic.topicId}/annotate`}
        className="ts-12 mono mt-4 inline-flex items-center justify-center gap-2 rounded px-4"
        style={primaryButtonStyle}
      >
        {topic.state === 'fresh' ? 'Start item' : 'Open item'}
        <ArrowRight size={14} />
      </Link>
    </section>
  )
}

function TaskContext({
  mode,
  dueText,
  total,
  counts,
}: {
  mode: string
  dueText: ReturnType<typeof formatDeadline> | null
  total: number
  counts: {
    fresh: number
    mine: number
    revision: number
    submitted: number
    others: number
  }
}) {
  return (
    <SidePanel label="TASK CONTEXT" title="Progress" icon={<ListChecks size={16} />}>
      <div className="grid gap-2 ts-12 mono" style={{ color: 'var(--mute2)' }}>
        <Fact label="Template" value={formatTemplateMode(mode)} />
        <Fact label="Deadline" value={dueText ? dueText.label : 'Not set'} tone={dueText?.urgency} />
        <Fact label="Total rows" value={String(total)} />
        <Fact label="Claimable" value={String(counts.fresh)} />
        <Fact label="My drafts" value={String(counts.mine)} />
        <Fact label="Needs revision" value={String(counts.revision)} tone={counts.revision > 0 ? 'warning' : undefined} />
      </div>
    </SidePanel>
  )
}

function GuidelinesPanel({ text }: { text: string | null }) {
  return (
    <SidePanel label="GUIDELINES" title="Task instructions" icon={<BookOpen size={16} />}>
      {text ? (
        <div
          className="task-guidelines-preview"
          style={{
            maxHeight: 420,
            overflow: 'auto',
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize]}
          >
            {text}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="ts-12" style={{ color: 'var(--mute2)' }}>
          No separate guideline document is attached to this task.
        </p>
      )}
    </SidePanel>
  )
}

function WorkflowPanel() {
  return (
    <SidePanel label="WORKFLOW" title="How this moves" icon={<ShieldCheck size={16} />}>
      <div className="grid gap-3">
        <WorkflowStep icon={<Play size={14} />} title="Claim or resume" body="Opening a fresh row starts the work session." />
        <WorkflowStep icon={<Sparkles size={14} />} title="Draft autosaves" body="The annotation workbench saves progress before submit." />
        <WorkflowStep icon={<ShieldCheck size={14} />} title="AI and human review" body="Submitted rows can pass, escalate, or come back for revision." />
      </div>
    </SidePanel>
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
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="lbl">{label}</div>
        <h2 className="ts-16 mt-1" style={{ color: 'var(--hi)', fontWeight: 560 }}>
          {title}
        </h2>
        {body ? (
          <p className="ts-12 mt-1 max-w-[720px]" style={{ color: 'var(--mute2)' }}>
            {body}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

function SidePanel({
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
          <h2 className="ts-16 mt-1" style={{ color: 'var(--hi)', fontWeight: 560 }}>
            {title}
          </h2>
        </div>
        <span style={{ color: 'var(--mute)' }}>{icon}</span>
      </div>
      {children}
    </section>
  )
}

function FilterChip({
  href,
  active,
  label,
  count,
  tone = 'neutral',
}: {
  href: string
  active: boolean
  label: string
  count: number
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'muted'
}) {
  const palette = chipPalette(tone)
  return (
    <Link
      href={href}
      className="ts-12 mono inline-flex items-center gap-2 rounded px-3"
      style={{
        minHeight: 36,
        background: active ? palette.bg : 'var(--panel)',
        color: active ? palette.fg : 'var(--mute)',
        border: `1px solid ${active ? palette.line : 'var(--line)'}`,
        textDecoration: 'none',
      }}
    >
      {label}
      <span style={{ color: active ? palette.fg : 'var(--mute2)' }}>
        {count}
      </span>
    </Link>
  )
}

function ActiveLearningHint({ visible }: { visible: MyTaskTopicRow[] }) {
  const freshWithIg = visible.filter(
    (t) => t.state === 'fresh' && t.igScore != null,
  )
  if (freshWithIg.length < 2) return null
  const scores = freshWithIg.map((t) => t.igScore as number)
  const spread = Math.max(...scores) - Math.min(...scores)
  if (spread < 0.1) return null
  const top = freshWithIg[0].igScore as number
  return (
    <div
      className="ts-12 mt-4 inline-flex items-center gap-2 rounded px-3 py-2"
      style={{
        background: 'oklch(0.55 0.18 320 / 0.08)',
        border: '1px solid oklch(0.55 0.18 320 / 0.3)',
        color: 'oklch(0.55 0.18 320)',
      }}
    >
      <Target size={14} />
      Fresh rows are ordered by information gain. Top row IG{' '}
      {Math.round(top * 100)}.
    </div>
  )
}

function TopicRow({
  topic,
  workspaceId,
}: {
  topic: MyTaskTopicRow
  workspaceId: string
}) {
  const pickable = topic.state !== 'others' && topic.state !== 'submitted'
  const href = `/workspaces/${workspaceId}/topics/${topic.topicId}/annotate`
  const content = (
    <div
      className="rounded p-4"
      style={{
        background: 'var(--bg)',
        border: `1px solid ${statePalette(topic.state).line}`,
        opacity: topic.state === 'others' ? 0.55 : 1,
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <TopicStateBadge topic={topic} />
            <WorkflowStatusBadge status={topic.workflowStatus} />
            {topic.difficulty != null ? <DifficultyBadge topic={topic} /> : null}
            {topic.state === 'fresh' &&
            topic.igScore != null &&
            topic.igScore >= 0.5 ? (
              <span
                className="ts-11 mono inline-flex items-center gap-1.5 rounded px-2 py-1"
                style={{
                  background: 'oklch(0.55 0.18 320 / 0.1)',
                  color: 'oklch(0.55 0.18 320)',
                  border: '1px solid oklch(0.55 0.18 320 / 0.4)',
                }}
              >
                <Target size={12} />
                IG {Math.round(topic.igScore * 100)}
              </span>
            ) : null}
          </div>
          <p
            className="ts-13 mt-3"
            style={{
              color: 'var(--text)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {topic.promptPreview}
          </p>
          {topic.reviewFeedback ? (
            <div
              className="ts-12 mt-3 rounded p-2"
              style={{
                color: 'var(--warn)',
                background: 'oklch(0.68 0.16 70 / 0.08)',
                border: '1px solid oklch(0.68 0.16 70 / 0.35)',
              }}
            >
              <span className="mono">Review note:</span> {topic.reviewFeedback}
            </div>
          ) : null}
          <div className="ts-11 mono mt-3" style={{ color: 'var(--mute2)' }}>
            created {topic.createdAt.toISOString().slice(0, 10)}
          </div>
        </div>
        <span
          className="ts-12 mono inline-flex items-center justify-center gap-2 rounded px-3"
          style={pickable ? primaryButtonStyle : ghostButtonStyle}
        >
          {topicActionLabel(topic)}
          {pickable ? <ArrowRight size={14} /> : <ExternalLink size={13} />}
        </span>
      </div>
    </div>
  )

  if (!pickable) return <li>{content}</li>
  return (
    <li>
      <Link href={href} style={{ textDecoration: 'none' }}>
        {content}
      </Link>
    </li>
  )
}

function TopicStateBadge({ topic }: { topic: MyTaskTopicRow }) {
  const palette = statePalette(topic.state)
  const Icon =
    topic.state === 'revision'
      ? RotateCcw
      : topic.state === 'mine'
        ? Play
        : topic.state === 'fresh'
          ? Sparkles
          : topic.state === 'submitted'
            ? CheckCircle2
            : AlertTriangle
  return (
    <span
      className="ts-11 mono inline-flex items-center gap-1.5 rounded px-2 py-1"
      style={{
        color: palette.fg,
        background: palette.bg,
        border: `1px solid ${palette.line}`,
      }}
    >
      <Icon size={13} />
      {stateLabel(topic.state)}
    </span>
  )
}

function WorkflowStatusBadge({ status }: { status: string }) {
  return (
    <span
      className="ts-11 mono inline-flex items-center gap-1.5 rounded px-2 py-1"
      style={{
        color: 'var(--mute)',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <Flag size={12} />
      {formatWorkflowStatus(status)}
    </span>
  )
}

function DifficultyBadge({ topic }: { topic: MyTaskTopicRow }) {
  const n = topic.difficulty ?? 0
  return (
    <span
      className="ts-11 mono inline-flex items-center gap-1.5 rounded px-2 py-1"
      style={{
        background: difficultyBg(n),
        color: difficultyFg(n),
        border: `1px solid ${difficultyFg(n)}44`,
      }}
      title={topic.difficultyReason ?? `AI difficulty ${n}/5`}
    >
      <Flame size={12} />
      {difficultyLabel(n)} · {n}/5
    </span>
  )
}

function WorkflowStep({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <div className="flex gap-3">
      <span
        className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded"
        style={{
          width: 24,
          height: 24,
          color: 'var(--accent)',
          background: 'var(--accent-soft)',
          border: '1px solid var(--accent-line)',
        }}
      >
        {icon}
      </span>
      <div>
        <div className="ts-13" style={{ color: 'var(--text)', fontWeight: 600 }}>
          {title}
        </div>
        <div className="ts-12 mt-0.5" style={{ color: 'var(--mute2)', lineHeight: 1.45 }}>
          {body}
        </div>
      </div>
    </div>
  )
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'overdue' | 'today' | 'soon' | 'later' | 'warning'
}) {
  const danger = tone === 'overdue' || tone === 'today' || tone === 'warning'
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span style={{ color: danger ? 'var(--danger)' : 'var(--text)' }}>
        {value}
      </span>
    </div>
  )
}

function EmptyState({ filter }: { filter: TopicFilter }) {
  return (
    <div
      className="mt-4 rounded p-8 text-center"
      style={{
        background: 'var(--bg)',
        border: '1px dashed var(--line2)',
      }}
    >
      <div className="ts-13" style={{ color: 'var(--text)', fontWeight: 600 }}>
        No rows here
      </div>
      <p className="ts-12 mt-1" style={{ color: 'var(--mute2)' }}>
        {filter === 'all'
          ? 'This task has no rows visible to you yet.'
          : 'Try another filter or return after the Owner publishes more work.'}
      </p>
    </div>
  )
}

function normalizeFilter(value?: string): TopicFilter {
  if (
    value === 'fresh' ||
    value === 'mine' ||
    value === 'revision' ||
    value === 'submitted'
  ) {
    return value
  }
  return 'all'
}

function nextTopicTitle(state: MyTaskTopicRow['state']): string {
  if (state === 'revision') return 'Fix a returned item'
  if (state === 'mine') return 'Resume your draft'
  if (state === 'fresh') return 'Claim a fresh item'
  return 'Review submitted work'
}

function topicActionLabel(topic: MyTaskTopicRow): string {
  if (topic.state === 'revision') return 'Revise'
  if (topic.state === 'mine') return 'Resume'
  if (topic.state === 'fresh') return 'Start'
  if (topic.state === 'submitted') return 'Submitted'
  return 'Taken'
}

function stateLabel(state: MyTaskTopicRow['state']): string {
  if (state === 'revision') return 'Needs revision'
  if (state === 'mine') return 'Draft'
  if (state === 'fresh') return 'Claimable'
  if (state === 'submitted') return 'Submitted'
  return 'Taken'
}

function statePalette(state: MyTaskTopicRow['state']) {
  if (state === 'revision') {
    return {
      fg: 'var(--warn)',
      bg: 'oklch(0.68 0.16 70 / 0.1)',
      line: 'oklch(0.68 0.16 70 / 0.35)',
    }
  }
  if (state === 'mine') {
    return {
      fg: 'var(--accent)',
      bg: 'var(--accent-soft)',
      line: 'var(--accent-line)',
    }
  }
  if (state === 'fresh') {
    return {
      fg: 'oklch(0.62 0.16 145)',
      bg: 'oklch(0.62 0.16 145 / 0.08)',
      line: 'oklch(0.62 0.16 145 / 0.32)',
    }
  }
  return {
    fg: 'var(--mute2)',
    bg: 'var(--panel2)',
    line: 'var(--line)',
  }
}

function chipPalette(tone: 'neutral' | 'accent' | 'success' | 'warning' | 'muted') {
  if (tone === 'accent') {
    return { fg: 'var(--accent)', bg: 'var(--accent-soft)', line: 'var(--accent-line)' }
  }
  if (tone === 'success') {
    return {
      fg: 'oklch(0.62 0.16 145)',
      bg: 'oklch(0.62 0.16 145 / 0.08)',
      line: 'oklch(0.62 0.16 145 / 0.32)',
    }
  }
  if (tone === 'warning') {
    return {
      fg: 'var(--warn)',
      bg: 'oklch(0.68 0.16 70 / 0.1)',
      line: 'oklch(0.68 0.16 70 / 0.35)',
    }
  }
  if (tone === 'muted') {
    return { fg: 'var(--mute2)', bg: 'var(--panel2)', line: 'var(--line)' }
  }
  return { fg: 'var(--mute)', bg: 'var(--panel)', line: 'var(--line)' }
}

function difficultyLabel(n: number): string {
  return ['easy', 'light', 'standard', 'hard', 'expert'][
    Math.max(0, Math.min(4, n - 1))
  ]
}

function difficultyFg(n: number): string {
  if (n <= 2) return 'var(--mute)'
  if (n === 3) return 'var(--text)'
  if (n === 4) return 'var(--warn)'
  return 'var(--danger)'
}

function difficultyBg(n: number): string {
  if (n <= 3) return 'var(--panel2)'
  if (n === 4) return 'oklch(0.68 0.16 70 / 0.1)'
  return 'oklch(0.55 0.2 25 / 0.1)'
}

function formatReward(value: number | null, currency: string | null): string {
  if (value == null) return 'Configured'
  return `${value.toFixed(2)} ${currency ?? ''}`.trim()
}

function formatTemplateMode(mode: string): string {
  if (mode === 'pair-rubric') return 'Pair rubric'
  if (mode === 'arena-gsb') return 'Arena GSB'
  if (mode === 'custom-designer') return 'Custom form'
  if (mode === 'agent-trace-eval') return 'Agent trace'
  return mode
}

function formatWorkflowStatus(status: string): string {
  if (status === 'drafting') return 'Drafting'
  if (status === 'revising') return 'Revising'
  if (status === 'submitted') return 'Submitted'
  if (status === 'ai_review') return 'AI review'
  if (status === 'reviewing') return 'Reviewing'
  if (status === 'awaiting_acceptance') return 'Awaiting acceptance'
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return status
}

function formatDeadline(d: Date): {
  label: string
  urgency: 'overdue' | 'today' | 'soon' | 'later'
} {
  const ms = d.getTime() - Date.now()
  if (ms < 0) return { label: 'Overdue', urgency: 'overdue' }
  const days = Math.floor(ms / (24 * 3600 * 1000))
  if (days === 0) return { label: 'Closes today', urgency: 'today' }
  if (days <= 2) return { label: `Closes in ${days}d`, urgency: 'soon' }
  return { label: `Closes in ${days}d`, urgency: 'later' }
}

const primaryButtonStyle: CSSProperties = {
  minHeight: 40,
  color: 'white',
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
  textDecoration: 'none',
  fontWeight: 600,
}

const ghostButtonStyle: CSSProperties = {
  minHeight: 40,
  color: 'var(--text)',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  textDecoration: 'none',
}
