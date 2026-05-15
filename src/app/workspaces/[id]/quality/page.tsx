import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { optionalUser, requireWorkspaceMember } from '@/lib/auth/guards'
import {
  getWorkspaceTrust,
  type UserTrust,
} from '@/lib/queries/trust-consensus'
import {
  getWorkspaceCalibration,
  listWorkspaceGoldStandards,
  type UserCalibration,
  type GoldStandardRow,
} from '@/lib/queries/gold-standards'
import {
  listWorkspaceCriticalViolations,
  type CriticalViolation,
} from '@/lib/queries/critical-violations'
import {
  listWorkspaceAnnotationTimes,
  formatElapsed,
  type AnnotationTimeRow,
} from '@/lib/queries/annotation-time'
import {
  getPairOrArenaIAA,
  type PairRubricRow,
  type ArenaDimensionRow,
  type ArenaOverallRow,
} from '@/lib/queries/pair-iaa'
import {
  getWorkspaceQualityTrend,
  type QualityTrendBucket,
} from '@/lib/queries/quality-trend'
import { TrustBadge } from '@/components/quality/trust-badge'
import { GoldBadge } from '@/components/quality/gold-badge'
import { QualityTrendPanel } from '@/components/quality/quality-trend-panel'

export const metadata: Metadata = {
  title: 'Quality — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/quality — admin's quality driver's seat.
 *
 * Three sections:
 *   1. Gold standards — reference answers admins have frozen
 *   2. Calibration leaderboard — how well raters match the golds
 *   3. Trust leaderboard — admin verdict + peer consensus
 *
 * This is the operational-intelligence surface: "where's my ground truth,
 * who's nailing it, who's drifting." Admin-only. Non-admin members see a
 * friendly explanation that this is admin-only data.
 *
 * /disputes covers the "where raters disagree" story; this page covers
 * "who's reliable" + "what counts as right." Distinct concerns; cross-linked
 * at the top.
 */
export default async function QualityPage(
  props: PageProps<'/workspaces/[id]/quality'>,
) {
  const { id: workspaceId } = await props.params

  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${workspaceId}/quality`)

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  const { role } = await requireWorkspaceMember(workspaceId)
  const isAdmin = role === 'admin' || workspace.adminId === me.id

  return (
    <div className="app-light min-h-screen" style={{ background: 'var(--bg)' }}>
      <header
        className="hairline-b sticky top-0 z-10"
        style={{ background: 'var(--panel)' }}
      >
        <div className="mx-auto max-w-[1200px] flex items-center justify-between px-6 py-3">
          <nav
            className="ts-12 mono flex items-center gap-1.5 min-w-0"
            style={{ color: 'var(--mute2)' }}
          >
            <Link
              href={`/workspaces/${workspaceId}`}
              className="truncate-1 hover:underline"
              style={{ color: 'var(--text)', maxWidth: 200 }}
            >
              {workspace.name}
            </Link>
            <span>/</span>
            <span style={{ color: 'var(--hi)' }}>quality</span>
          </nav>
          <Link href="/" className="ts-13 mono" style={{ color: 'var(--hi)' }}>
            <span style={{ color: 'var(--accent)' }}>§</span> labelhub
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-6 py-8">
        <div className="mb-8">
          <div className="lbl mb-2">§ OPERATIONAL INTELLIGENCE</div>
          <h1 className="ts-32" style={{ color: 'var(--hi)' }}>
            Quality
          </h1>
          <p
            className="ts-13 mt-1"
            style={{ color: 'var(--mute)', maxWidth: 720 }}
          >
            {isAdmin
              ? 'Reference answers, rater calibration, and trust scores. Admin-only — annotators see cold contribution counts on /my/earnings instead.'
              : "This page is for workspace admins. Visit /workspaces/.../disputes if you're chasing why raters disagreed on a step."}{' '}
            See also{' '}
            <Link
              href={`/workspaces/${workspaceId}/disputes`}
              style={{ color: 'var(--accent)', textDecoration: 'none' }}
            >
              /disputes →
            </Link>
          </p>
        </div>

        {!isAdmin ? (
          <NonAdminFallback />
        ) : (
          <QualityContent
            workspaceId={workspaceId}
            templateMode={workspace.templateMode}
          />
        )}
      </main>
    </div>
  )
}

function NonAdminFallback() {
  return (
    <div
      className="rounded-xl p-6"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line2)',
      }}
    >
      <h3 className="ts-16" style={{ color: 'var(--hi)', fontWeight: 500 }}>
        Admin-only
      </h3>
      <p className="ts-13 mt-2" style={{ color: 'var(--mute)' }}>
        Trust scores and calibration data are workspace-admin operational
        information — not shown to annotators or viewers. If you&apos;re
        looking for your contribution stats, check{' '}
        <Link
          href="/my/earnings"
          style={{ color: 'var(--accent)', textDecoration: 'none' }}
        >
          /my/earnings
        </Link>
        .
      </p>
    </div>
  )
}

/**
 * Server component — fans out the three sections' data fetches in parallel.
 */
async function QualityContent({
  workspaceId,
  templateMode,
}: {
  workspaceId: string
  templateMode: string
}) {
  const [golds, calibration, trust, violations, times, pairIaa, trend] =
    await Promise.all([
      listWorkspaceGoldStandards(workspaceId).catch(
        () => [] as GoldStandardRow[],
      ),
      getWorkspaceCalibration(workspaceId).catch(
        () => [] as UserCalibration[],
      ),
      getWorkspaceTrust(workspaceId).catch(() => [] as UserTrust[]),
      listWorkspaceCriticalViolations(workspaceId).catch(
        () => [] as CriticalViolation[],
      ),
      listWorkspaceAnnotationTimes(workspaceId).catch(
        () => [] as AnnotationTimeRow[],
      ),
      getPairOrArenaIAA({ workspaceId, templateMode }).catch(() => null),
      getWorkspaceQualityTrend({ workspaceId, weeks: 12 }).catch(
        () => [] as QualityTrendBucket[],
      ),
    ])

  const isPairOrArena =
    templateMode === 'pair-rubric' || templateMode === 'arena-gsb'

  return (
    <div className="space-y-10">
      {/* Quality trend — works for every mode (reads approve/reject events) */}
      <QualityTrendPanel buckets={trend} />

      {/*
        Trajectory-flavored sections (golds, calibration, violations,
        elapsed) only make sense for agent-trace-eval — they all read
        step_annotations / trajectory_steps. We hide them for pair/arena
        workspaces and instead show the IAA panels up top.
      */}
      {isPairOrArena && pairIaa && pairIaa.mode !== 'unsupported' && (
        <PairIaaQualitySection iaa={pairIaa} />
      )}
      {!isPairOrArena && (
        <>
          <CriticalViolationsSection
            workspaceId={workspaceId}
            violations={violations}
          />
          <ElapsedTimesSection workspaceId={workspaceId} times={times} />
          <GoldStandardsSection workspaceId={workspaceId} golds={golds} />
          <CalibrationLeaderboard
            workspaceId={workspaceId}
            rows={calibration}
            goldCount={golds.length}
          />
        </>
      )}
      <TrustLeaderboard rows={trust} />
    </div>
  )
}

/**
 * Pair/arena IAA condensed for the /quality dashboard. Disputes page
 * has the full breakdown; here we just summarize "how noisy is each
 * rubric / dimension" so the admin can spot drift in one glance.
 */
function PairIaaQualitySection({
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
        <div className="lbl mb-2">§ RUBRIC AGREEMENT (multi-rater topics)</div>
        {iaa.pairRubric.length === 0 ? (
          <EmptyIaaCard kind="rubric" />
        ) : (
          <SimpleAgreementTable
            rows={iaa.pairRubric.map((r) => ({
              key: r.rubricId,
              multi: r.multiRaterTopics,
              disputed: r.disputedTopics,
              rate: r.agreementRate,
            }))}
          />
        )}
      </section>
    )
  }
  if (iaa.mode === 'arena-gsb') {
    return (
      <>
        <section>
          <div className="lbl mb-2">§ DIMENSION AGREEMENT (multi-rater topics)</div>
          {iaa.arenaDimensions.length === 0 ? (
            <EmptyIaaCard kind="dimension" />
          ) : (
            <SimpleAgreementTable
              rows={iaa.arenaDimensions.map((r) => ({
                key: r.dimensionId,
                multi: r.multiRaterTopics,
                disputed: r.disputedTopics,
                rate: r.agreementRate,
              }))}
            />
          )}
        </section>
        {iaa.arenaOverall && iaa.arenaOverall.multiRaterTopics > 0 && (
          <section>
            <div className="lbl mb-2">§ OVERALL VERDICT</div>
            <div
              className="rounded-md p-4 ts-13"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
              }}
            >
              <span style={{ color: 'var(--mute)' }}>
                multi-rater topics:{' '}
              </span>
              <strong style={{ color: 'var(--text)' }}>
                {iaa.arenaOverall.multiRaterTopics}
              </strong>
              <span style={{ color: 'var(--mute)' }}> · agreement: </span>
              <strong style={{ color: 'var(--text)' }}>
                {iaa.arenaOverall.multiRaterTopics === 0
                  ? '—'
                  : `${Math.round((1 - iaa.arenaOverall.disputedTopics / iaa.arenaOverall.multiRaterTopics) * 100)}%`}
              </strong>
              <span style={{ color: 'var(--mute)' }}> · tally: </span>
              <span className="mono ts-12">
                A {iaa.arenaOverall.byVerdict.a_better} / tie{' '}
                {iaa.arenaOverall.byVerdict.tie} / B{' '}
                {iaa.arenaOverall.byVerdict.b_better}
              </span>
            </div>
          </section>
        )}
      </>
    )
  }
  return null
}

function SimpleAgreementTable({
  rows,
}: {
  rows: Array<{
    key: string
    multi: number
    disputed: number
    rate: number | null
  }>
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
              style={{ color: 'var(--mute)', width: 100 }}
            >
              SAMPLES
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
              style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--line)' }}
            >
              <td
                className="px-4 py-2 mono ts-12"
                style={{ color: 'var(--text)' }}
              >
                {r.key}
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

function EmptyIaaCard({ kind }: { kind: 'rubric' | 'dimension' }) {
  return (
    <div
      className="rounded-md px-4 py-6 text-center ts-13"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line)',
        color: 'var(--mute2)',
      }}
    >
      No {kind} agreement data yet — at least two annotators must submit
      on the same topic.
    </div>
  )
}

// ─── Elapsed times ───────────────────────────────────────────────────────

function ElapsedTimesSection({
  workspaceId,
  times,
}: {
  workspaceId: string
  times: AnnotationTimeRow[]
}) {
  const flagged = times.filter((t) => t.flag === 'fast' || t.flag === 'slow')
  const shown = flagged.length > 0 ? flagged : times.slice(0, 8)
  return (
    <section>
      <SectionHeader
        title="ANNOTATION TIME"
        hint={
          times.length === 0
            ? 'no submitted annotations yet'
            : flagged.length > 0
              ? `${flagged.length} flagged · ${times.length} total`
              : `${times.length} submitted · no flags`
        }
      />
      {times.length === 0 ? (
        <EmptyLeaderboardCard message="No annotations have been submitted yet — once they are, wall-clock time will appear here." />
      ) : (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          <table className="w-full ts-13">
            <thead
              style={{
                color: 'var(--mute2)',
                borderBottom: '1px solid var(--line)',
                fontSize: 11,
                fontFamily: 'var(--font-geist-mono), monospace',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              <tr>
                <th className="text-left p-3">rater</th>
                <th className="text-left p-3">trajectory</th>
                <th className="text-left p-3">elapsed</th>
                <th className="text-left p-3">flag</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t, idx) => (
                <tr
                  key={t.annotationId}
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                  }}
                >
                  <td className="p-3" style={{ color: 'var(--hi)' }}>
                    {t.raterDisplayName ?? t.raterId.slice(0, 8)}
                  </td>
                  <td className="p-3">
                    {t.trajectoryId ? (
                      <Link
                        href={`/workspaces/${workspaceId}/trajectories/${t.trajectoryId}`}
                        className="ts-12 mono hover:underline"
                        style={{ color: 'var(--accent)' }}
                      >
                        {t.trajectoryAgentName ?? t.trajectoryId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
                        —
                      </span>
                    )}
                  </td>
                  <td className="p-3 mono" style={{ color: 'var(--text)' }}>
                    {formatElapsed(t.elapsedSeconds)}
                  </td>
                  <td className="p-3">
                    <TimeFlag flag={t.flag} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {flagged.length === 0 && times.length > shown.length && (
            <div
              className="p-3 ts-11 mono text-center"
              style={{
                color: 'var(--mute2)',
                borderTop: '1px solid var(--line)',
              }}
            >
              + {times.length - shown.length} more · no flags raised on the rest
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function TimeFlag({ flag }: { flag: 'fast' | 'slow' | 'ok' | null }) {
  if (!flag || flag === 'ok') {
    return (
      <span
        className="mono ts-11"
        style={{ color: 'var(--mute2)' }}
        title="No threshold set on this task, or within bounds."
      >
        —
      </span>
    )
  }
  const palette =
    flag === 'fast'
      ? {
          bg: 'oklch(0.7 0.14 75 / 0.08)',
          fg: 'var(--warn)',
          bord: 'oklch(0.7 0.14 75 / 0.4)',
          label: '⚡ fast',
          title:
            'Annotation submitted faster than the task\'s minExpectedSeconds — possible speed-skip without reading.',
        }
      : {
          bg: 'var(--danger-soft)',
          fg: 'var(--danger)',
          bord: 'oklch(0.55 0.2 25 / 0.4)',
          label: '⏱ over',
          title:
            'Annotation exceeded the task\'s maxBillableSeconds — possible idle time or stuck rater.',
        }
  return (
    <span
      className="mono ts-11"
      title={palette.title}
      style={{
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.bord}`,
        borderRadius: 4,
        padding: '1px 8px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {palette.label}
    </span>
  )
}

// ─── Critical violations ─────────────────────────────────────────────────

function CriticalViolationsSection({
  workspaceId,
  violations,
}: {
  workspaceId: string
  violations: CriticalViolation[]
}) {
  return (
    <section>
      <SectionHeader
        title="CRITICAL VIOLATIONS"
        hint={
          violations.length === 0
            ? 'no critical-rubric flags raised yet'
            : `${violations.length} flag${violations.length === 1 ? '' : 's'} — one bad rating on a critical rubric vetoes a trajectory's quality`
        }
      />
      {violations.length === 0 ? (
        <div
          className="rounded-xl p-5"
          style={{
            background: 'var(--panel)',
            border: '1px dashed var(--line2)',
          }}
        >
          <p className="ts-13" style={{ color: 'var(--mute)' }}>
            No critical-rubric flags. A rubric marked{' '}
            <strong style={{ color: 'var(--danger)' }}>severity: critical</strong>{' '}
            (e.g. <em>Safety</em>) raises a flag when a rater scores it the
            worst possible value — likert 1, bool false, or the last enum
            option. This is the closest LabelHub gets to a one-veto override.
          </p>
        </div>
      ) : (
        <ul
          className="rounded-xl overflow-hidden"
          style={{
            background: 'var(--panel)',
            border: '1px solid oklch(0.55 0.2 25 / 0.4)',
          }}
        >
          {violations.slice(0, 12).map((v, idx) => (
            <li
              key={`${v.trajectoryId}-${v.rubricId}-${v.raterId}-${idx}`}
              className="flex items-center justify-between gap-3 p-3"
              style={{
                borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="mono shrink-0"
                  style={{
                    background: 'var(--danger-soft)',
                    color: 'var(--danger)',
                    border: '1px solid oklch(0.55 0.2 25 / 0.4)',
                    borderRadius: 4,
                    padding: '1px 6px',
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  🔥 {v.rubricName}
                </span>
                <div className="min-w-0">
                  <Link
                    href={`/workspaces/${workspaceId}/trajectories/${v.trajectoryId}`}
                    className="ts-13 hover:underline trunc-1"
                    style={{ color: 'var(--hi)' }}
                  >
                    {v.trajectoryAgentName}
                  </Link>
                  <div
                    className="mono ts-11 mt-0.5"
                    style={{ color: 'var(--mute2)' }}
                  >
                    flagged by{' '}
                    {v.raterDisplayName ?? v.raterId.slice(0, 8)} ·{' '}
                    {v.level === 'step'
                      ? `on step ${v.stepId?.slice(0, 8) ?? ''}…`
                      : 'trajectory-level'}
                  </div>
                </div>
              </div>
              <Link
                href={`/workspaces/${workspaceId}/trajectories/${v.trajectoryId}`}
                className="ts-12 mono shrink-0"
                style={{
                  color: 'var(--danger)',
                  textDecoration: 'none',
                }}
              >
                inspect →
              </Link>
            </li>
          ))}
          {violations.length > 12 && (
            <li
              className="p-3 ts-11 mono text-center"
              style={{
                color: 'var(--mute2)',
                borderTop: '1px solid var(--line)',
              }}
            >
              + {violations.length - 12} more
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

// ─── Gold standards section ──────────────────────────────────────────────

function GoldStandardsSection({
  workspaceId,
  golds,
}: {
  workspaceId: string
  golds: GoldStandardRow[]
}) {
  return (
    <section>
      <SectionHeader
        title="GOLD STANDARDS"
        hint={`${golds.length} reference answer${golds.length === 1 ? '' : 's'} frozen`}
      />
      {golds.length === 0 ? (
        <div
          className="rounded-xl p-5"
          style={{
            background: 'var(--panel)',
            border: '1px dashed var(--line2)',
          }}
        >
          <p className="ts-13" style={{ color: 'var(--mute)' }}>
            No gold standards yet. To freeze a reference answer: annotate a
            trajectory yourself, then open it and click{' '}
            <strong style={{ color: 'var(--text)' }}>★ promote to gold</strong>.
            Every other rater&apos;s marks will be calibrated against it.
          </p>
        </div>
      ) : (
        <ul
          className="rounded-xl overflow-hidden"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          {golds.map((g, idx) => (
            <li
              key={g.id}
              className="flex items-center justify-between gap-3 p-3"
              style={{
                borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <GoldBadge size="sm" />
                <div className="min-w-0">
                  <Link
                    href={`/workspaces/${workspaceId}/trajectories/${g.trajectoryId}`}
                    className="ts-13 hover:underline trunc-1"
                    style={{ color: 'var(--hi)' }}
                  >
                    trajectory {g.trajectoryId.slice(0, 8)}…
                  </Link>
                  <div
                    className="mono ts-11 mt-0.5"
                    style={{ color: 'var(--mute2)' }}
                  >
                    promoted{' '}
                    {g.promotedAt.toISOString().slice(0, 10)} by{' '}
                    {g.promotedByDisplayName ?? g.promotedByUserId.slice(0, 8)}{' '}
                    · {g.rubricCount} mark{g.rubricCount === 1 ? '' : 's'} frozen
                  </div>
                </div>
              </div>
              <Link
                href={`/workspaces/${workspaceId}/trajectories/${g.trajectoryId}`}
                className="ts-12 mono"
                style={{
                  color: 'var(--accent)',
                  textDecoration: 'none',
                }}
              >
                open →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ─── Calibration leaderboard ─────────────────────────────────────────────

function CalibrationLeaderboard({
  workspaceId: _workspaceId,
  rows,
  goldCount,
}: {
  workspaceId: string
  rows: UserCalibration[]
  goldCount: number
}) {
  return (
    <section>
      <SectionHeader
        title="CALIBRATION VS GOLD"
        hint={
          goldCount === 0
            ? 'no golds yet — leaderboard will populate once you promote'
            : `${rows.length} rater${rows.length === 1 ? '' : 's'} scored against ${goldCount} gold${goldCount === 1 ? '' : 's'}`
        }
      />
      {rows.length === 0 ? (
        <EmptyLeaderboardCard
          message={
            goldCount === 0
              ? 'No gold standards exist yet — calibration scores need ground truth to compare against.'
              : 'No raters have annotated the gold trajectories yet. Once they do, this leaderboard will rank them by how often they match the reference answers.'
          }
        />
      ) : (
        <LeaderboardTable
          headers={['rater', 'score', 'matched', 'diverged', 'golds covered']}
          rows={rows.map((r) => {
            const pct = Math.round(r.score * 100)
            const tone =
              r.score >= 0.8
                ? 'success'
                : r.score >= 0.6
                  ? 'default'
                  : r.score >= 0.4
                    ? 'warn'
                    : 'danger'
            return {
              key: r.userId,
              cells: [
                r.displayName ?? r.userId.slice(0, 8),
                <Pct key="pct" value={pct} tone={tone} />,
                String(r.matched),
                String(r.diverged),
                String(r.goldsCovered),
              ],
            }
          })}
        />
      )}
    </section>
  )
}

// ─── Trust leaderboard ───────────────────────────────────────────────────

function TrustLeaderboard({ rows }: { rows: UserTrust[] }) {
  return (
    <section>
      <SectionHeader
        title="TRUST"
        hint={`${rows.length} rater${rows.length === 1 ? '' : 's'} · admin verdicts override peer consensus where available`}
      />
      {rows.length === 0 ? (
        <EmptyLeaderboardCard message="No annotation activity in this workspace yet." />
      ) : (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          <table className="w-full ts-13">
            <thead
              style={{
                color: 'var(--mute2)',
                borderBottom: '1px solid var(--line)',
                fontSize: 11,
                fontFamily: 'var(--font-geist-mono), monospace',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              <tr>
                <th className="text-left p-3">rater</th>
                <th className="text-left p-3">source</th>
                <th className="text-left p-3">badge</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={r.userId}
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                  }}
                >
                  <td className="p-3" style={{ color: 'var(--hi)' }}>
                    {r.displayName ?? r.userId.slice(0, 8)}
                  </td>
                  <td className="p-3">
                    <SourceTag source={r.source} />
                  </td>
                  <td className="p-3">
                    <TrustBadge trust={r} viewerIsAdmin />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function SourceTag({ source }: { source: 'admin' | 'peer' }) {
  const label = source === 'admin' ? 'admin verdict' : 'peer consensus'
  const tone =
    source === 'admin'
      ? {
          bg: 'var(--accent-soft)',
          fg: 'var(--accent)',
          bord: 'var(--accent-line)',
        }
      : {
          bg: 'var(--panel2)',
          fg: 'var(--mute)',
          bord: 'var(--line)',
        }
  return (
    <span
      className="mono ts-11"
      style={{
        background: tone.bg,
        color: tone.fg,
        border: `1px solid ${tone.bord}`,
        padding: '2px 8px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
      }}
      title={
        source === 'admin'
          ? 'Score is derived from admin approval/rejection events — authoritative.'
          : 'Score is derived from median-of-other-raters agreement — preliminary, no admin verdicts yet.'
      }
    >
      {label}
    </span>
  )
}

// ─── Shared bits ─────────────────────────────────────────────────────────

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

function EmptyLeaderboardCard({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line2)',
      }}
    >
      <p className="ts-13" style={{ color: 'var(--mute)' }}>
        {message}
      </p>
    </div>
  )
}

function LeaderboardTable({
  headers,
  rows,
}: {
  headers: string[]
  rows: Array<{ key: string; cells: React.ReactNode[] }>
}) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <table className="w-full ts-13">
        <thead
          style={{
            color: 'var(--mute2)',
            borderBottom: '1px solid var(--line)',
            fontSize: 11,
            fontFamily: 'var(--font-geist-mono), monospace',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left p-3">
                {h}
              </th>
            ))}
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
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className="p-3"
                  style={{ color: i === 0 ? 'var(--hi)' : 'var(--text)' }}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Pct({
  value,
  tone,
}: {
  value: number
  tone: 'success' | 'default' | 'warn' | 'danger'
}) {
  const color =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'warn'
        ? 'var(--warn)'
        : tone === 'danger'
          ? 'var(--danger)'
          : 'var(--hi)'
  return (
    <span className="mono" style={{ color, fontWeight: 600 }}>
      {value}%
    </span>
  )
}
