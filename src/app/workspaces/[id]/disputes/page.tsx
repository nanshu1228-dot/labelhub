import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import {
  getWorkspaceIaaSummary,
  listTopDisputes,
  type RaterMark,
} from '@/lib/queries/iaa'
import { listRecentPatches } from '@/lib/actions/guideline-refiner'
import { RefinerActionClient } from '@/components/disputes/refiner-action-client'
import { PatchActionsClient } from '@/components/disputes/patch-actions-client'

export const metadata: Metadata = {
  title: 'Disputes — LabelHub',
}

/**
 * /workspaces/[id]/disputes
 *
 * The "self-evolving" surface — visualizes the platform's quality loop:
 *
 *   step_annotation (rater) → IAA → disputes → Claude → guideline_patch → admin → new guideline
 *
 * Three sections:
 *   1. Workspace-level agreement metrics
 *   2. Top disputed steps (the corpus for Claude's refiner)
 *   3. Pending + recent patches (Claude's proposals + admin decisions)
 */
export default async function DisputesPage(
  props: PageProps<'/workspaces/[id]/disputes'>,
) {
  const { id: workspaceId } = await props.params
  let workspaceName = 'workspace'
  let dbError: string | null = null
  let summary: Awaited<ReturnType<typeof getWorkspaceIaaSummary>> | null = null
  let disputes: Awaited<ReturnType<typeof listTopDisputes>> = []
  let patches: Awaited<ReturnType<typeof listRecentPatches>> = []

  try {
    const workspace = await getWorkspaceById(workspaceId)
    if (!workspace) notFound()
    workspaceName = workspace.name
    ;[summary, disputes, patches] = await Promise.all([
      getWorkspaceIaaSummary(workspaceId),
      listTopDisputes({ workspaceId, limit: 20 }),
      listRecentPatches(workspaceId, 20),
    ])
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e)
  }

  const demoMode = process.env.LABELHUB_DEMO_MODE === 'true'
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY

  return (
    <div className="app-light min-h-screen">
      <Header workspaceId={workspaceId} workspaceName={workspaceName} />

      <main className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="mb-6">
          <div className="lbl mb-2">§ SELF-EVOLVING QUALITY LOOP</div>
          <h1 className="ts-32" style={{ color: 'var(--hi)' }}>
            Disputes
          </h1>
          <p className="ts-13 mt-1" style={{ color: 'var(--mute)' }}>
            Where annotators disagree. Claude reads the cases and proposes
            guideline patches that admins can merge.
          </p>
        </div>

        {dbError ? (
          <DbError message={dbError} />
        ) : (
          <div className="flex flex-col gap-10">
            {summary && <IaaSummary summary={summary} />}

            <section>
              <SectionHeader
                title="TOP DISPUTED STEPS"
                hint={`${disputes.length} step${disputes.length === 1 ? '' : 's'} with spread > 1`}
              />
              {disputes.length === 0 ? (
                <EmptyDisputes />
              ) : (
                <>
                  <DisputeList workspaceId={workspaceId} disputes={disputes} />
                  {demoMode && hasAnthropicKey && (
                    <div className="mt-4">
                      <RefinerActionClient workspaceId={workspaceId} />
                    </div>
                  )}
                  {!hasAnthropicKey && (
                    <p
                      className="mt-3 ts-12 mono"
                      style={{ color: 'var(--mute2)' }}
                    >
                      Set <span style={{ color: 'var(--hi)' }}>
                        ANTHROPIC_API_KEY
                      </span>{' '}
                      in env to enable the AI Guideline Refiner.
                    </p>
                  )}
                </>
              )}
            </section>

            <section>
              <SectionHeader
                title="GUIDELINE PATCHES"
                hint={`${patches.filter((p) => p.status === 'pending').length} pending · ${patches.length} total`}
              />
              {patches.length === 0 ? (
                <p
                  className="ts-13 italic"
                  style={{ color: 'var(--mute)' }}
                >
                  No patches yet — click &quot;Refine with Claude&quot; above
                  to generate one from the disputes.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {patches.map((p) => (
                    <PatchCard
                      key={p.id}
                      workspaceId={workspaceId}
                      patch={p}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────

function Header({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string
  workspaceName: string
}) {
  return (
    <header
      className="hairline-b sticky top-0 z-10"
      style={{ background: 'var(--panel)' }}
    >
      <div className="mx-auto max-w-[1200px] flex items-center justify-between px-6 py-3">
        <nav
          className="ts-12 mono flex items-center gap-1.5"
          style={{ color: 'var(--mute2)' }}
        >
          <Link
            href={`/workspaces/${workspaceId}`}
            className="truncate-1 hover:underline"
            style={{ color: 'var(--text)', maxWidth: 200 }}
          >
            {workspaceName}
          </Link>
          <span>/</span>
          <span style={{ color: 'var(--hi)' }}>disputes</span>
        </nav>
        <Link
          href="/"
          className="ts-13 mono"
          style={{ color: 'var(--hi)' }}
          aria-label="LabelHub"
        >
          <span style={{ color: 'var(--accent)' }}>§</span> labelhub
        </Link>
      </div>
    </header>
  )
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <div className="lbl">§ {title}</div>
      {hint && (
        <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// IAA summary tiles

function IaaSummary({
  summary,
}: {
  summary: NonNullable<Awaited<ReturnType<typeof getWorkspaceIaaSummary>>>
}) {
  const pct =
    summary.agreementRate != null
      ? Math.round(summary.agreementRate * 1000) / 10
      : null
  return (
    <section>
      <SectionHeader title="AGREEMENT METRICS" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="annotated steps"
          value={summary.annotatedSteps.toString()}
        />
        <Tile
          label="multi-rater steps"
          value={summary.multiRaterSteps.toString()}
          hint={
            summary.multiRaterSteps === 0
              ? 'need ≥2 annotators per step for IAA'
              : ''
          }
        />
        <Tile
          label="disputed"
          value={summary.disputedSteps.toString()}
          tone={summary.disputedSteps > 0 ? 'danger' : undefined}
          hint="rating spread > 1"
        />
        <Tile
          label="agreement rate"
          value={pct == null ? '—' : `${pct}%`}
          tone={
            pct == null
              ? undefined
              : pct >= 80
                ? 'success'
                : pct >= 60
                  ? undefined
                  : 'danger'
          }
        />
      </div>
    </section>
  )
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'success' | 'danger'
}) {
  const color =
    tone === 'danger'
      ? 'var(--danger)'
      : tone === 'success'
        ? 'var(--success)'
        : 'var(--hi)'
  return (
    <div
      className="p-4 rounded-xl"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div
        className="ts-12 mono mb-1.5 uppercase"
        style={{ color: 'var(--mute2)', letterSpacing: '0.05em' }}
      >
        {label}
      </div>
      <div className="ts-24 mono" style={{ color }}>
        {value}
      </div>
      {hint && (
        <div className="ts-12 mt-1" style={{ color: 'var(--mute)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Dispute list

function DisputeList({
  workspaceId,
  disputes,
}: {
  workspaceId: string
  disputes: Awaited<ReturnType<typeof listTopDisputes>>
}) {
  return (
    <ul className="flex flex-col gap-3">
      {disputes.map((d) => (
        <li
          key={d.trajectoryStepId}
          className="rounded-xl px-4 py-3"
          style={{
            border: '1px solid var(--line)',
            background: 'var(--panel)',
          }}
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <SpreadChip spread={d.spread} />
              <Link
                href={`/workspaces/${workspaceId}/trajectories/${d.trajectoryId}`}
                className="ts-12 mono hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                open trajectory →
              </Link>
            </div>
            <span
              className="ts-12 mono"
              style={{ color: 'var(--mute2)' }}
            >
              step {d.trajectoryStepId.slice(0, 8)}…
            </span>
          </div>
          <RaterTable raters={d.raters} />
        </li>
      ))}
    </ul>
  )
}

function SpreadChip({ spread }: { spread: number }) {
  const map: Record<
    number,
    { label: string; color: string; bg: string; bord: string }
  > = {
    2: {
      label: 'spread 2',
      color: 'var(--warn)',
      bg: 'oklch(0.7 0.14 75 / 0.08)',
      bord: 'oklch(0.7 0.14 75 / 0.4)',
    },
    4: {
      label: 'spread 4 (extreme)',
      color: 'var(--danger)',
      bg: 'var(--danger-soft)',
      bord: 'oklch(0.6 0.2 25 / 0.4)',
    },
  }
  const def = map[spread] ?? map[4]
  return (
    <span
      className="badge"
      style={{
        color: def.color,
        background: def.bg,
        borderColor: def.bord,
      }}
    >
      ⚡ {def.label}
    </span>
  )
}

function RaterTable({ raters }: { raters: RaterMark[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {raters.map((r) => {
        const lab =
          r.rating === 5
            ? { t: '✓ correct', c: 'var(--success)' }
            : r.rating === 3
              ? { t: '⚠ suspicious', c: 'var(--warn)' }
              : r.rating === 1
                ? { t: '✗ wrong', c: 'var(--danger)' }
                : { t: '?', c: 'var(--mute)' }
        return (
          <li key={r.userId} className="ts-13 flex items-start gap-2 flex-wrap">
            <span
              className="mono"
              style={{
                color: 'var(--mute2)',
                minWidth: 110,
                flexShrink: 0,
              }}
            >
              {r.displayName ?? r.userId.slice(0, 8)}
            </span>
            <span
              className="mono"
              style={{
                color: lab.c,
                fontWeight: 600,
                minWidth: 110,
                flexShrink: 0,
              }}
            >
              {lab.t}
            </span>
            <span style={{ color: 'var(--text)' }}>{r.reasoning}</span>
          </li>
        )
      })}
    </ul>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Patch card

function PatchCard({
  workspaceId,
  patch,
}: {
  workspaceId: string
  patch: Awaited<ReturnType<typeof listRecentPatches>>[number]
}) {
  const statusStyle: Record<
    string,
    { color: string; bg: string; bord: string; label: string }
  > = {
    pending: {
      color: 'var(--warn)',
      bg: 'oklch(0.7 0.14 75 / 0.08)',
      bord: 'oklch(0.7 0.14 75 / 0.4)',
      label: 'pending review',
    },
    accepted: {
      color: 'var(--success)',
      bg: 'var(--success-soft)',
      bord: 'oklch(0.65 0.13 150 / 0.4)',
      label: 'merged',
    },
    rejected: {
      color: 'var(--mute)',
      bg: 'var(--panel2)',
      bord: 'var(--line2)',
      label: 'rejected',
    },
  }
  const s = statusStyle[patch.status] ?? statusStyle.pending
  return (
    <li
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div
        className="px-4 py-2 flex items-center justify-between gap-3 hairline-b"
        style={{ background: 'var(--panel2)' }}
      >
        <div className="flex items-center gap-2 ts-12 mono">
          <span
            className="badge"
            style={{ color: s.color, background: s.bg, borderColor: s.bord }}
          >
            {s.label}
          </span>
          <span style={{ color: 'var(--mute)' }}>
            against guideline v{patch.guidelineVersion}
          </span>
        </div>
        <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
          {new Date(patch.createdAt).toLocaleString()}
        </span>
      </div>
      <div className="p-4">
        {patch.rationale && (
          <div className="ts-13 mb-3" style={{ color: 'var(--text)' }}>
            <span
              className="mono"
              style={{ color: 'var(--mute2)' }}
            >
              rationale:
            </span>{' '}
            {patch.rationale}
          </div>
        )}
        <pre
          className="ts-13 p-3 rounded-md overflow-x-auto whitespace-pre-wrap"
          style={{
            background: 'var(--panel2)',
            border: '1px solid var(--line)',
            color: 'var(--hi)',
            fontFamily: 'var(--font-geist-mono), monospace',
          }}
        >
          {patch.patchContent}
        </pre>
        {patch.status === 'pending' && (
          <div className="mt-3">
            <PatchActionsClient
              workspaceId={workspaceId}
              patchId={patch.id}
            />
          </div>
        )}
      </div>
    </li>
  )
}

function EmptyDisputes() {
  return (
    <div
      className="text-center py-10 px-6 rounded-xl"
      style={{ border: '1px dashed var(--line2)', background: 'var(--panel)' }}
    >
      <div
        className="ts-13 mono mb-2"
        style={{ color: 'var(--mute2)', letterSpacing: '0.05em' }}
      >
        § NO DISPUTES YET
      </div>
      <p className="ts-13" style={{ color: 'var(--mute)' }}>
        Either annotators all agree, or no step has ≥2 raters yet. Try
        running <span className="mono" style={{ color: 'var(--hi)' }}>
          npm run seed:disputes
        </span>{' '}
        to inject synthetic disagreement.
      </p>
    </div>
  )
}

function DbError({ message }: { message: string }) {
  return (
    <div
      className="p-6 rounded-xl"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div
        className="ts-13 mono mb-2"
        style={{ color: 'var(--danger)', letterSpacing: '0.05em' }}
      >
        § DATABASE NOT REACHABLE
      </div>
      <pre
        className="mt-2 ts-12 mono p-3 overflow-auto whitespace-pre-wrap"
        style={{
          background: 'var(--code-bg)',
          border: '1px solid var(--code-line)',
          color: 'var(--code-text)',
          borderRadius: 8,
        }}
      >
        {message}
      </pre>
    </div>
  )
}
