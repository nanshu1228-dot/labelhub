import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  optionalUser,
  requireWorkspaceAdmin,
} from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getJudgeDetail } from '@/lib/queries/llm-judges'
import { JudgeRunControls } from '@/components/llm-judge/judge-run-controls'

export const metadata: Metadata = {
  title: 'Judge detail — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/judges/[judgeId] — judge config + run history.
 *
 * Top section: name, tier, system prompt (collapsible).
 * Middle: "▶ run on N samples" form.
 * Bottom: list of runs with status + agreement % + link to detail.
 */
export default async function JudgeDetailPage(props: {
  params: Promise<{ id: string; judgeId: string }>
}) {
  const { id: workspaceId, judgeId } = await props.params
  const me = await optionalUser()
  if (!me) {
    redirect(
      `/signin?next=/workspaces/${workspaceId}/judges/${judgeId}`,
    )
  }
  try {
    await requireWorkspaceAdmin(workspaceId)
  } catch {
    notFound()
  }
  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  const detail = await getJudgeDetail(judgeId)
  if (!detail) notFound()

  return (
    <div
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <main className="mx-auto max-w-[1000px]">
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
            href={`/workspaces/${workspaceId}/judges`}
            style={{ color: 'var(--mute)' }}
            className="hover:underline"
          >
            judges
          </Link>
          <span style={{ color: 'var(--mute2)' }}>·</span>
          <span style={{ color: 'var(--text)' }}>{detail.judge.name}</span>
        </nav>

        <div className="mb-6 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="lbl">§ JUDGE</div>
            <h1
              className="ts-24 mt-1"
              style={{ color: 'var(--hi)' }}
            >
              {detail.judge.name}
            </h1>
          </div>
          <span
            className="mono ts-11 px-2 py-0.5 rounded"
            style={{
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              border: '1px solid var(--accent-line)',
            }}
          >
            tier · {detail.judge.tier}
          </span>
        </div>

        <details
          className="mb-6 rounded-md"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          <summary
            className="ts-12 mono px-4 py-2 cursor-pointer"
            style={{ color: 'var(--mute)' }}
          >
            system prompt ({detail.judge.systemPrompt.length} chars) — click to expand
          </summary>
          <pre
            className="ts-12 mono px-4 py-3 whitespace-pre-wrap"
            style={{
              color: 'var(--text)',
              borderTop: '1px solid var(--line)',
              maxHeight: 400,
              overflow: 'auto',
            }}
          >
            {detail.judge.systemPrompt}
          </pre>
        </details>

        <section className="mb-6">
          <div className="lbl mb-2">§ RUN</div>
          <JudgeRunControls judgeId={judgeId} workspaceId={workspaceId} />
        </section>

        <section>
          <div className="lbl mb-2">
            § HISTORY · {detail.runs.length} run
            {detail.runs.length === 1 ? '' : 's'}
          </div>
          {detail.runs.length === 0 ? (
            <div
              className="rounded-md p-6 text-center ts-13"
              style={{
                background: 'var(--panel)',
                border: '1px dashed var(--line)',
                color: 'var(--mute)',
              }}
            >
              No runs yet — pick a sample size and hit run.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {detail.runs.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/workspaces/${workspaceId}/judges/${judgeId}/runs/${r.id}`}
                    className="block rounded-md px-4 py-3"
                    style={{
                      background: 'var(--panel)',
                      border: '1px solid var(--line)',
                      textDecoration: 'none',
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="ts-13" style={{ color: 'var(--text)' }}>
                        {r.startedAt.toLocaleString(undefined, {
                          hour12: false,
                        })}{' '}
                        ·{' '}
                        <span
                          className="mono"
                          style={{ color: 'var(--mute2)' }}
                        >
                          {r.sampleCount} sample
                          {r.sampleCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusChip status={r.status} />
                        {r.agreementScore != null && (
                          <span
                            className="ts-13 mono"
                            style={{
                              color: 'var(--accent)',
                              fontWeight: 600,
                            }}
                          >
                            {Math.round(r.agreementScore * 100)}%
                          </span>
                        )}
                      </div>
                    </div>
                    {r.errorText && (
                      <div
                        className="ts-12 mono mt-1"
                        style={{ color: 'var(--danger)' }}
                      >
                        {r.errorText}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { fg: string; bg: string }> = {
    completed: {
      fg: 'oklch(0.5 0.13 150)',
      bg: 'oklch(0.5 0.13 150 / 0.12)',
    },
    running: {
      fg: 'oklch(0.6 0.18 280)',
      bg: 'oklch(0.6 0.18 280 / 0.12)',
    },
    failed: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
  }
  const c = map[status] ?? { fg: 'var(--mute)', bg: 'var(--panel2)' }
  return (
    <span
      className="mono ts-11 px-2 py-0.5 rounded"
      style={{
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.fg}55`,
      }}
    >
      {status}
    </span>
  )
}
