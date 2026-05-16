import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { optionalUser, requireWorkspaceAdmin } from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { listJudgesForWorkspace } from '@/lib/queries/llm-judges'

export const metadata: Metadata = {
  title: 'LLM judges — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/judges — list of configured LLM judges + their
 * agreement with human raters. Admin-only.
 *
 * Each card shows: name, model tier, last agreement %, runs count,
 * and a link to detail. Empty state explains the concept + invites
 * creating the first judge.
 */
export default async function JudgesPage(props: {
  params: Promise<{ id: string }>
}) {
  const { id: workspaceId } = await props.params
  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${workspaceId}/judges`)
  try {
    await requireWorkspaceAdmin(workspaceId)
  } catch {
    notFound()
  }
  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  // v1 limitation: judge runs sample from pair-rubric / arena-gsb
  // annotations only — trajectory mode has a richer payload shape we
  // haven't built a runner for yet. Surface this up-front so admins
  // who navigated here directly don't waste time setting up a judge
  // that can never run successfully.
  const isUnsupportedMode =
    workspace.templateMode !== 'pair-rubric' &&
    workspace.templateMode !== 'arena-gsb'

  const judges = await listJudgesForWorkspace(workspaceId)

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
          <span style={{ color: 'var(--text)' }}>judges</span>
        </nav>

        <div className="flex items-baseline justify-between mb-6 gap-4 flex-wrap">
          <div>
            <div className="lbl">§ LLM JUDGES</div>
            <h1
              className="ts-28 mt-1"
              style={{ color: 'var(--hi)' }}
            >
              Judge calibration
            </h1>
            <p
              className="ts-13 mt-1"
              style={{ color: 'var(--mute)', maxWidth: 640 }}
            >
              Configure a model to grade annotations the same way humans do.
              The platform runs it on a random sample of your annotated
              topics and shows how often the model agrees with your raters.
              Use this to harden judge prompts before deploying them in
              automated pipelines.
            </p>
          </div>
          {!isUnsupportedMode && (
            <Link
              href={`/workspaces/${workspaceId}/judges/new`}
              className="ts-13 mono"
              style={{
                background: 'var(--accent)',
                color: 'white',
                border: '1px solid var(--accent)',
                borderRadius: 6,
                padding: '8px 14px',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              + new judge
            </Link>
          )}
        </div>

        {isUnsupportedMode && (
          <div
            className="rounded-md p-3 mb-4"
            style={{
              background: 'var(--warn-soft)',
              border: '1px solid oklch(0.6 0.14 75 / 0.4)',
            }}
          >
            <div
              className="lbl"
              style={{ color: 'oklch(0.55 0.14 75)' }}
            >
              § JUDGES NOT SUPPORTED FOR {workspace.templateMode.toUpperCase()}
            </div>
            <p className="ts-13 mt-1" style={{ color: 'var(--text)' }}>
              LLM judges currently grade pair-rubric and arena-gsb
              annotations — the runner doesn&apos;t handle the
              trajectory payload shape yet. This workspace is in{' '}
              <span className="mono">{workspace.templateMode}</span>{' '}
              mode, so creating a judge here would have nothing to run
              on. Track the work in the backlog under{' '}
              <span className="mono">trajectory-judge v2</span>.
            </p>
          </div>
        )}

        {judges.length === 0 ? (
          <div
            className="rounded-md p-6 text-center ts-13"
            style={{
              background: 'var(--panel)',
              border: '1px dashed var(--line)',
              color: 'var(--mute)',
            }}
          >
            <div className="ts-22 mb-2" aria-hidden>
              ⚖
            </div>
            <div style={{ fontWeight: 500, color: 'var(--text)' }}>
              No judges yet
            </div>
            <p
              className="ts-12 mt-1 mx-auto"
              style={{ color: 'var(--mute)', maxWidth: 380 }}
            >
              Set up a judge to measure how a model would score against
              your raters. Cheap calibration loop for picking the right
              model tier + prompt.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {judges.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/workspaces/${workspaceId}/judges/${j.id}`}
                  className="block rounded-md p-4"
                  style={{
                    background: 'var(--panel)',
                    border: '1px solid var(--line)',
                    textDecoration: 'none',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <div
                      className="ts-15"
                      style={{ color: 'var(--hi)', fontWeight: 500 }}
                    >
                      {j.name}
                    </div>
                    <span
                      className="mono ts-11 px-2 py-0.5 rounded"
                      style={{
                        background: 'var(--accent-soft)',
                        color: 'var(--accent)',
                        border: '1px solid var(--accent-line)',
                      }}
                    >
                      tier · {j.tier}
                    </span>
                  </div>
                  <div
                    className="ts-12 mt-2 grid grid-cols-3 gap-3 mono"
                  >
                    <Mini
                      label="LAST AGREEMENT"
                      value={
                        j.lastAgreement != null
                          ? `${Math.round(j.lastAgreement * 100)}%`
                          : '—'
                      }
                      accent={j.lastAgreement != null}
                    />
                    <Mini label="RUNS" value={String(j.runCount)} />
                    <Mini
                      label="LAST RUN"
                      value={
                        j.lastRunAt
                          ? formatRelative(j.lastRunAt)
                          : 'never'
                      }
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function Mini({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div>
      <div
        className="ts-11"
        style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
      >
        {label}
      </div>
      <div
        className="ts-14 mono mt-0.5"
        style={{
          color: accent ? 'var(--accent)' : 'var(--text)',
          fontWeight: 600,
        }}
      >
        {value}
      </div>
    </div>
  )
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return d.toISOString().slice(5, 10).replace('-', '/')
}
