import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  optionalUser,
  requireWorkspaceMember,
} from '@/lib/auth/guards'
import { getTaskById } from '@/lib/queries/tasks'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import {
  getGuidelineHistory,
  lineDiff,
  type GuidelineVersion,
  type GuidelinePatch,
  type DiffLine,
} from '@/lib/queries/guideline-history'

export const metadata: Metadata = {
  title: 'Guideline history — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/tasks/[taskId]/guidelines
 *
 * "Living guidelines" timeline for a task. Shows every version of the
 * annotation guideline + all AI/human-proposed patches with their
 * status. A `?diff=v2..v3` query selects which versions to diff side
 * by side — defaults to "latest two versions" so the page lands on
 * something useful.
 *
 * Member-readable (everyone can see how the rules evolved), but only
 * admins see the patch-decision controls (handled on /disputes).
 *
 * This is the second half of the platform's self-evolving story:
 * /disputes shows where raters disagree → Claude proposes a patch →
 * admin accepts → version bumps → this page shows the lineage.
 */
export default async function GuidelineHistoryPage(props: {
  params: Promise<{ id: string; taskId: string }>
  searchParams?: Promise<{ diff?: string }>
}) {
  const { id: workspaceId, taskId } = await props.params
  const search = (await props.searchParams) ?? {}

  const me = await optionalUser()
  if (!me) {
    redirect(
      `/signin?next=/workspaces/${workspaceId}/tasks/${taskId}/guidelines`,
    )
  }
  try {
    await requireWorkspaceMember(workspaceId)
  } catch {
    notFound()
  }

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()
  const task = await getTaskById(taskId)
  if (!task || task.workspaceId !== workspaceId) notFound()

  const history = await getGuidelineHistory({ taskId })

  // Resolve diff selection — ?diff=v3..v5 (numbers refer to .version,
  // not array index). Default: last two versions if any.
  let diffPair: [GuidelineVersion, GuidelineVersion] | null = null
  if (history.versions.length >= 2) {
    const fromVer = Number(search.diff?.split('..')[0]?.replace('v', ''))
    const toVer = Number(search.diff?.split('..')[1]?.replace('v', ''))
    const from =
      Number.isFinite(fromVer)
        ? history.versions.find((v) => v.version === fromVer)
        : history.versions[history.versions.length - 2]
    const to =
      Number.isFinite(toVer)
        ? history.versions.find((v) => v.version === toVer)
        : history.versions[history.versions.length - 1]
    if (from && to && from.version !== to.version) {
      diffPair =
        from.version < to.version ? [from, to] : [to, from]
    }
  }

  return (
    <main
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <div className="mx-auto max-w-[1100px]">
        <nav className="ts-12 mono flex items-center gap-1.5 mb-4">
          <Link
            href={`/workspaces/${workspaceId}`}
            style={{ color: 'var(--mute)' }}
            className="hover:underline"
          >
            {workspace.name}
          </Link>
          <span style={{ color: 'var(--mute2)' }}>·</span>
          <Link
            href={`/workspaces/${workspaceId}/tasks`}
            style={{ color: 'var(--mute)' }}
            className="hover:underline"
          >
            tasks
          </Link>
          <span style={{ color: 'var(--mute2)' }}>·</span>
          <Link
            href={`/workspaces/${workspaceId}/tasks/${taskId}`}
            style={{ color: 'var(--mute)' }}
            className="hover:underline"
          >
            {task.name}
          </Link>
          <span style={{ color: 'var(--mute2)' }}>·</span>
          <span style={{ color: 'var(--text)' }}>guidelines</span>
        </nav>

        <div className="mb-6">
          <div className="lbl">§ LIVING GUIDELINES</div>
          <h1
            className="ts-24 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 600 }}
          >
            Guideline evolution
          </h1>
          <p className="ts-13 mt-1" style={{ color: 'var(--mute)' }}>
            Every version of this task&apos;s annotation guideline, plus the
            AI-proposed + admin-accepted patches that produced it.
          </p>
        </div>

        {history.versions.length === 0 ? (
          <EmptyHistory />
        ) : (
          <>
            <section className="mb-8">
              <div className="lbl mb-2">§ VERSIONS</div>
              <VersionTimeline
                versions={history.versions}
                selected={diffPair}
                workspaceId={workspaceId}
                taskId={taskId}
              />
            </section>

            {diffPair && (
              <section className="mb-8">
                <div className="lbl mb-2">
                  § DIFF · v{diffPair[0].version} → v{diffPair[1].version}
                </div>
                <DiffView
                  diff={lineDiff(diffPair[0].content, diffPair[1].content)}
                />
              </section>
            )}

            {history.patches.length > 0 && (
              <section>
                <div className="lbl mb-2">§ PATCHES</div>
                <PatchList patches={history.patches} versions={history.versions} />
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}

// ─── Version timeline ────────────────────────────────────────────────────

function VersionTimeline({
  versions,
  selected,
  workspaceId,
  taskId,
}: {
  versions: GuidelineVersion[]
  selected: [GuidelineVersion, GuidelineVersion] | null
  workspaceId: string
  taskId: string
}) {
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ')
  const selKeys = selected
    ? new Set([selected[0].version, selected[1].version])
    : new Set<number>()
  return (
    <ol
      className="rounded-md"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        listStyle: 'none',
        padding: 0,
        margin: 0,
      }}
    >
      {versions.map((v, idx) => {
        const isSelected = selKeys.has(v.version)
        // Diff link goes from previous version to this one.
        const prev = idx > 0 ? versions[idx - 1] : null
        const diffHref = prev
          ? `/workspaces/${workspaceId}/tasks/${taskId}/guidelines?diff=v${prev.version}..v${v.version}`
          : null
        return (
          <li
            key={v.id}
            style={{
              borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
              padding: '10px 14px',
              background: isSelected
                ? 'oklch(0.6 0.18 280 / 0.05)'
                : 'transparent',
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
            }}
          >
            <span
              className="mono ts-11"
              style={{
                background: 'var(--panel2)',
                color: 'var(--accent)',
                border: '1px solid oklch(0.6 0.18 280 / 0.3)',
                borderRadius: 4,
                padding: '1px 6px',
                fontWeight: 600,
                minWidth: 28,
                textAlign: 'center',
              }}
            >
              v{v.version}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                className="ts-12 mono truncate"
                style={{ color: 'var(--mute)' }}
                title={v.content}
              >
                {v.content.split('\n')[0].slice(0, 80) || '(empty)'}
              </p>
              <p
                className="ts-11 mono mt-0.5"
                style={{ color: 'var(--mute2)' }}
              >
                {fmt(v.createdAt)}
              </p>
            </div>
            {diffHref && (
              <Link
                href={diffHref}
                className="ts-11 mono shrink-0"
                style={{
                  color: 'var(--accent)',
                  textDecoration: 'none',
                }}
              >
                diff from v{prev?.version} →
              </Link>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ─── Unified diff renderer ───────────────────────────────────────────────

function DiffView({ diff }: { diff: DiffLine[] }) {
  let addedCount = 0
  let removedCount = 0
  for (const d of diff) {
    if (d.kind === 'add') addedCount++
    else if (d.kind === 'del') removedCount++
  }
  return (
    <div
      className="rounded-md overflow-hidden"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div
        className="px-4 py-2 flex items-center justify-between mono ts-11"
        style={{
          background: 'var(--panel2)',
          borderBottom: '1px solid var(--line)',
          color: 'var(--mute)',
        }}
      >
        <span>{diff.length} lines · line-by-line LCS diff</span>
        <span>
          <span style={{ color: 'oklch(0.65 0.18 200)' }}>
            +{addedCount}
          </span>{' '}
          ·{' '}
          <span style={{ color: 'var(--danger)' }}>
            -{removedCount}
          </span>
        </span>
      </div>
      <pre
        className="ts-13 mono"
        style={{
          margin: 0,
          padding: '8px 0',
          background: 'var(--panel)',
          color: 'var(--text)',
          maxHeight: 600,
          overflow: 'auto',
        }}
      >
        {diff.map((d, idx) => (
          <DiffRow key={idx} d={d} />
        ))}
      </pre>
    </div>
  )
}

function DiffRow({ d }: { d: DiffLine }) {
  const palette =
    d.kind === 'add'
      ? {
          bg: 'oklch(0.65 0.18 200 / 0.08)',
          marker: '+',
          color: 'oklch(0.65 0.18 200)',
        }
      : d.kind === 'del'
        ? {
            bg: 'oklch(0.55 0.2 25 / 0.07)',
            marker: '-',
            color: 'var(--danger)',
          }
        : {
            bg: 'transparent',
            marker: ' ',
            color: 'var(--text)',
          }
  return (
    <div
      style={{
        background: palette.bg,
        padding: '1px 16px 1px 4px',
        whiteSpace: 'pre-wrap',
        lineHeight: 1.45,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 16,
          textAlign: 'center',
          color: palette.color,
          fontWeight: 600,
        }}
      >
        {palette.marker}
      </span>
      <span style={{ color: palette.color }}>{d.line || ' '}</span>
    </div>
  )
}

// ─── Patches list ────────────────────────────────────────────────────────

function PatchList({
  patches,
  versions,
}: {
  patches: GuidelinePatch[]
  versions: GuidelineVersion[]
}) {
  const versionByGuidelineId = new Map(versions.map((v) => [v.id, v.version]))
  return (
    <ul className="flex flex-col gap-3">
      {patches.map((p) => {
        const tag = STATUS_META[p.status] ?? {
          bg: 'var(--panel2)',
          fg: 'var(--mute)',
        }
        const v = versionByGuidelineId.get(p.guidelineId)
        return (
          <li
            key={p.id}
            className="rounded-md p-4"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span
                className="mono ts-11"
                style={{
                  background: tag.bg,
                  color: tag.fg,
                  border: `1px solid ${tag.fg}33`,
                  borderRadius: 4,
                  padding: '1px 8px',
                  fontWeight: 600,
                }}
              >
                {p.status}
              </span>
              {v !== undefined && (
                <span
                  className="mono ts-11"
                  style={{ color: 'var(--mute2)' }}
                >
                  patched v{v}
                </span>
              )}
              <span
                className="mono ts-11"
                style={{ color: 'var(--mute2)' }}
              >
                by {p.proposedBy === 'system' ? 'Claude' : p.proposedBy.slice(0, 8)}
              </span>
              <span
                className="mono ts-11 ml-auto"
                style={{ color: 'var(--mute2)' }}
              >
                {p.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
              </span>
            </div>
            {p.rationale && (
              <p
                className="ts-13 mb-2"
                style={{ color: 'var(--text)', lineHeight: 1.5 }}
              >
                {p.rationale}
              </p>
            )}
            <pre
              className="ts-12 mono"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 5,
                padding: '8px 12px',
                margin: 0,
                whiteSpace: 'pre-wrap',
                color: 'var(--mute)',
                maxHeight: 280,
                overflow: 'auto',
              }}
            >
              {p.patchContent}
            </pre>
          </li>
        )
      })}
    </ul>
  )
}

const STATUS_META: Record<string, { bg: string; fg: string }> = {
  pending: {
    bg: 'oklch(0.7 0.14 75 / 0.15)',
    fg: 'oklch(0.7 0.14 75)',
  },
  accepted: {
    bg: 'var(--success-soft)',
    fg: 'var(--success)',
  },
  rejected: {
    bg: 'var(--danger-soft)',
    fg: 'var(--danger)',
  },
}

// ─── Empty ───────────────────────────────────────────────────────────────

function EmptyHistory() {
  return (
    <div
      className="rounded-md p-6 text-center"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line)',
      }}
    >
      <p className="ts-13" style={{ color: 'var(--mute)' }}>
        No guideline versions for this task yet. They get seeded on the
        first AI-refinement run, or whenever an admin merges a manually-
        proposed patch.
      </p>
    </div>
  )
}
