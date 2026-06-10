import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import {
  getWorkspaceIaaSummary,
  listTopDisputes,
  type AnnotatorMark,
} from '@/lib/queries/iaa'
import {
  getWorkspaceTrust,
  type UserTrust,
} from '@/lib/queries/trust-consensus'
import { optionalUser, requireWorkspaceMember } from '@/lib/auth/guards'
import { listRecentPatches } from '@/lib/actions/guideline-refiner'
import { isAnyProviderConfigured } from '@/lib/ai/client'
import { RefinerActionClient } from '@/components/disputes/refiner-action-client'
import { PatchActionsClient } from '@/components/disputes/patch-actions-client'
import { TrustBadge } from '@/components/quality/trust-badge'
import { DbError } from '@/components/ui/db-error'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionHeader } from '@/components/ui/section-header'
import {
  getPairOrArenaIAA,
  type PairRubricRow,
  type ArenaDimensionRow,
  type ArenaOverallRow,
} from '@/lib/queries/pair-iaa'

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
  let workspaceMode = 'agent-trace-eval'
  let dbError: string | null = null
  let summary: Awaited<ReturnType<typeof getWorkspaceIaaSummary>> | null = null
  let disputes: Awaited<ReturnType<typeof listTopDisputes>> = []
  let patches: Awaited<ReturnType<typeof listRecentPatches>> = []
  let pairIaa: {
    mode: 'pair-rubric' | 'arena-gsb' | 'unsupported'
    pairRubric: PairRubricRow[]
    arenaDimensions: ArenaDimensionRow[]
    arenaOverall: ArenaOverallRow | null
  } | null = null
  const trustByUserId: Record<string, UserTrust> = {}
  let isAdmin = false

  // Access control: members only (any role can view disputes; admin
  // features layer on with `isAdmin`). Unauth bounces to /signin;
  // non-members get a generic 404 — don't leak existence.
  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${workspaceId}/disputes`)
  try {
    await requireWorkspaceMember(workspaceId)
  } catch {
    notFound()
  }

  try {
    const workspace = await getWorkspaceById(workspaceId)
    if (!workspace) notFound()
    workspaceName = workspace.name
    workspaceMode = workspace.templateMode

    {
      // Resolve viewer's role — trust scores are admin-only operational data,
      // never shown to annotators (would create perverse incentives).
      const { role } = await requireWorkspaceMember(workspaceId)
      isAdmin = role === 'admin' || workspace.adminId === me!.id
    }

    const [s, d, p, trustList, pair] = await Promise.all([
      getWorkspaceIaaSummary(workspaceId),
      listTopDisputes({ workspaceId, limit: 20 }),
      listRecentPatches(workspaceId, 20),
      isAdmin
        ? getWorkspaceTrust(workspaceId).catch(() => [] as UserTrust[])
        : Promise.resolve([] as UserTrust[]),
      getPairOrArenaIAA({
        workspaceId,
        templateMode: workspace.templateMode,
      }),
    ])
    summary = s
    disputes = d
    patches = p
    pairIaa = pair
    for (const t of trustList) trustByUserId[t.userId] = t
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e)
  }

  const demoMode = process.env.LABELHUB_DEMO_MODE === 'true'
  // Any provider counts — the refiner is provider-agnostic.
  const hasAIProvider = isAnyProviderConfigured()

  // Fresh-workspace gate: when every data source is empty, the page would
  // otherwise stack four blank chart sections (zeroed metric tiles, empty
  // IAA tables, an empty-disputes box, an empty-patches box) — a "looks
  // broken" signal. Collapse all of that into one shared EmptyState. The
  // normal full render is preserved untouched when ANY source has data.
  const pairHasData =
    pairIaa != null &&
    pairIaa.mode !== 'unsupported' &&
    (pairIaa.pairRubric.length > 0 ||
      pairIaa.arenaDimensions.length > 0 ||
      (pairIaa.arenaOverall != null &&
        pairIaa.arenaOverall.multiRaterTopics > 0))
  const isEmpty =
    !dbError &&
    disputes.length === 0 &&
    patches.length === 0 &&
    (summary == null || summary.annotatedSteps === 0) &&
    !pairHasData

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
        ) : isEmpty ? (
          <EmptyState
            label="§ NO DISPUTES YET"
            title="No disputes yet"
            description="Disputes appear once multiple annotators disagree on a topic. Check who has submitted, then revisit this page."
            cta={{
              kind: 'link',
              href: `/workspaces/${workspaceId}/quality`,
              label: 'View quality',
            }}
            secondary={{
              href: `/workspaces/${workspaceId}`,
              label: 'Back to workspace',
            }}
          />
        ) : (
          <div className="flex flex-col gap-10">
            {summary && <IaaSummary summary={summary} />}

            {pairIaa && pairIaa.mode !== 'unsupported' && (
              <PairIaaPanels iaa={pairIaa} />
            )}

            {workspaceMode === 'agent-trace-eval' && (
              <>
            <section>
              <SectionHeader
                title="TOP DISPUTED STEPS"
                hint={`${disputes.length} step${disputes.length === 1 ? '' : 's'} with spread > 1`}
              />
              {disputes.length === 0 ? (
                <EmptyDisputes />
              ) : (
                <>
                  <DisputeList
                    workspaceId={workspaceId}
                    disputes={disputes}
                    trustByUserId={trustByUserId}
                    viewerIsAdmin={isAdmin}
                  />
                  {demoMode && hasAIProvider && (
                    <div className="mt-4">
                      <RefinerActionClient workspaceId={workspaceId} />
                    </div>
                  )}
                  {!hasAIProvider && (
                    <p
                      className="mt-3 ts-12 mono"
                      style={{ color: 'var(--mute2)' }}
                    >
                      Set any of{' '}
                      <span style={{ color: 'var(--hi)' }}>
                        DOUBAO_API_KEY
                      </span>{' '}
                      ·{' '}
                      <span style={{ color: 'var(--hi)' }}>
                        ANTHROPIC_API_KEY
                      </span>{' '}
                      ·{' '}
                      <span style={{ color: 'var(--hi)' }}>OPENAI_API_KEY</span>{' '}
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
                <div
                  className="rounded-md px-4 py-5 ts-13"
                  style={{
                    background: 'var(--panel)',
                    border: '1px dashed var(--line)',
                    color: 'var(--mute)',
                  }}
                >
                  <p>
                    No guideline patches yet. Disputes between raters
                    are the raw material — when at least two raters
                    disagree on the same step, the &quot;Refine with
                    Claude&quot; button above can turn that disagreement
                    into a proposed clarification.
                  </p>
                  <p
                    className="ts-12 mono mt-2"
                    style={{ color: 'var(--mute2)' }}
                  >
                    Tip: open <code>/workspaces/{workspaceId}/quality</code>{' '}
                    to see whether any raters have submitted yet.
                  </p>
                </div>
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
              </>
            )}
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
  trustByUserId,
  viewerIsAdmin,
}: {
  workspaceId: string
  disputes: Awaited<ReturnType<typeof listTopDisputes>>
  trustByUserId: Record<string, UserTrust>
  viewerIsAdmin: boolean
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
          <RaterTable
            raters={d.raters}
            trustByUserId={trustByUserId}
            viewerIsAdmin={viewerIsAdmin}
          />
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

function RaterTable({
  raters,
  trustByUserId,
  viewerIsAdmin,
}: {
  raters: AnnotatorMark[]
  trustByUserId: Record<string, UserTrust>
  viewerIsAdmin: boolean
}) {
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
        const trust = trustByUserId[r.userId] ?? null
        return (
          <li key={r.userId} className="ts-13 flex items-start gap-2 flex-wrap">
            <span
              className="mono flex items-center gap-1.5"
              style={{
                color: 'var(--mute2)',
                minWidth: viewerIsAdmin ? 180 : 110,
                flexShrink: 0,
              }}
            >
              <span className="trunc-1" style={{ maxWidth: 110 }}>
                {r.displayName ?? r.userId.slice(0, 8)}
              </span>
              <TrustBadge
                trust={trust}
                viewerIsAdmin={viewerIsAdmin}
                size="sm"
                showCounts={false}
              />
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

// ─────────────────────────────────────────────────────────────────────────
// Pair-rubric / arena-gsb IAA panels. Renders when the workspace's
// templateMode is one of those — disagreement signals derived from
// `annotations.payload` (not step_annotations).

function PairIaaPanels({
  iaa,
}: {
  iaa: {
    mode: 'pair-rubric' | 'arena-gsb' | 'unsupported'
    pairRubric: PairRubricRow[]
    arenaDimensions: ArenaDimensionRow[]
    arenaOverall: ArenaOverallRow | null
  }
}) {
  if (iaa.mode === 'pair-rubric') {
    return (
      <section>
        <SectionHeader
          title="RUBRIC DISAGREEMENT · YES/NO PER MODEL"
          hint={
            iaa.pairRubric.length === 0
              ? 'no multi-rater data yet'
              : `${iaa.pairRubric.length} rubric${iaa.pairRubric.length === 1 ? '' : 's'} tracked`
          }
        />
        {iaa.pairRubric.length === 0 ? (
          <PairEmpty kind="rubric" />
        ) : (
          <AgreementTable
            rows={iaa.pairRubric.map((r) => ({
              key: r.rubricId,
              label: r.rubricId,
              multi: r.multiRaterTopics,
              disputed: r.disputedTopics,
              rate: r.agreementRate,
            }))}
            unitLabel="topic"
          />
        )}
      </section>
    )
  }
  if (iaa.mode === 'arena-gsb') {
    return (
      <>
        <section>
          <SectionHeader
            title="DIMENSION DISAGREEMENT · 1-5 PER MODEL"
            hint={
              iaa.arenaDimensions.length === 0
                ? 'no multi-rater data yet'
                : `${iaa.arenaDimensions.length} dimension${iaa.arenaDimensions.length === 1 ? '' : 's'} tracked`
            }
          />
          {iaa.arenaDimensions.length === 0 ? (
            <PairEmpty kind="dimension" />
          ) : (
            <AgreementTable
              rows={iaa.arenaDimensions.map((r) => ({
                key: r.dimensionId,
                label: r.dimensionId,
                multi: r.multiRaterTopics,
                disputed: r.disputedTopics,
                rate: r.agreementRate,
              }))}
              unitLabel="topic"
            />
          )}
        </section>
        {iaa.arenaOverall && (
          <section>
            <SectionHeader
              title="OVERALL VERDICT AGREEMENT"
              hint={`${iaa.arenaOverall.multiRaterTopics} multi-rater topic${iaa.arenaOverall.multiRaterTopics === 1 ? '' : 's'}`}
            />
            <OverallVerdictPanel overall={iaa.arenaOverall} />
          </section>
        )}
      </>
    )
  }
  return null
}

function AgreementTable({
  rows,
  unitLabel,
}: {
  rows: Array<{
    key: string
    label: string
    multi: number
    disputed: number
    rate: number | null
  }>
  unitLabel: string
}) {
  return (
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
              ID
            </th>
            <th
              className="px-4 py-2 mono ts-11 text-center"
              style={{ color: 'var(--mute)', width: 140 }}
            >
              MULTI-RATER {unitLabel.toUpperCase()}S
            </th>
            <th
              className="px-4 py-2 mono ts-11 text-center"
              style={{ color: 'var(--mute)', width: 100 }}
            >
              DISPUTED
            </th>
            <th
              className="px-4 py-2 mono ts-11 text-center"
              style={{ color: 'var(--mute)', width: 100 }}
            >
              AGREEMENT
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={r.key}
              style={{
                borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
              }}
            >
              <td
                className="px-4 py-2 mono ts-12"
                style={{ color: 'var(--text)' }}
              >
                {r.label}
              </td>
              <td
                className="px-4 py-2 mono ts-12 text-center"
                style={{ color: 'var(--mute)' }}
              >
                {r.multi}
              </td>
              <td
                className="px-4 py-2 mono ts-12 text-center"
                style={{
                  color: r.disputed > 0 ? 'var(--danger)' : 'var(--mute)',
                }}
              >
                {r.disputed}
              </td>
              <td
                className="px-4 py-2 mono ts-12 text-center"
                style={{
                  color:
                    r.rate === null
                      ? 'var(--mute2)'
                      : r.rate >= 0.8
                        ? 'oklch(0.65 0.18 200)'
                        : r.rate >= 0.5
                          ? 'oklch(0.7 0.14 75)'
                          : 'var(--danger)',
                  fontWeight: 600,
                }}
              >
                {r.rate === null ? '—' : `${Math.round(r.rate * 100)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OverallVerdictPanel({
  overall,
}: {
  overall: ArenaOverallRow
}) {
  const total =
    overall.byVerdict.a_better +
    overall.byVerdict.tie +
    overall.byVerdict.b_better
  const rate =
    overall.multiRaterTopics === 0
      ? null
      : 1 - overall.disputedTopics / overall.multiRaterTopics
  return (
    <div
      className="rounded-md p-4 grid grid-cols-1 md:grid-cols-4 gap-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <Tile
        label="AGREEMENT"
        value={rate === null ? '—' : `${Math.round(rate * 100)}%`}
        hint="multi-rater topics where every rater picked the same verdict"
      />
      <Tile
        label="A_BETTER VOTES"
        value={overall.byVerdict.a_better.toString()}
        hint={total > 0 ? `${Math.round((overall.byVerdict.a_better / total) * 100)}% of all` : '—'}
      />
      <Tile
        label="TIE VOTES"
        value={overall.byVerdict.tie.toString()}
        hint={total > 0 ? `${Math.round((overall.byVerdict.tie / total) * 100)}% of all` : '—'}
      />
      <Tile
        label="B_BETTER VOTES"
        value={overall.byVerdict.b_better.toString()}
        hint={total > 0 ? `${Math.round((overall.byVerdict.b_better / total) * 100)}% of all` : '—'}
      />
    </div>
  )
}

function PairEmpty({ kind }: { kind: 'rubric' | 'dimension' }) {
  return (
    <div
      className="rounded-md px-4 py-6 text-center ts-13 mono"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line)',
        color: 'var(--mute2)',
      }}
    >
      No {kind} disagreement data yet — IAA needs at least two
      annotators to submit on the same topic.
    </div>
  )
}
