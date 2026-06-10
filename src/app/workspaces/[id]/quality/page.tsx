import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { optionalUser, requireWorkspaceMember } from '@/lib/auth/guards'
import { getWorkspaceTrust, type UserTrust } from '@/lib/queries/trust-consensus'
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
  type AnnotationTimeRow,
} from '@/lib/queries/annotation-time'
import { getPairOrArenaIAA } from '@/lib/queries/pair-iaa'
import {
  getWorkspaceQualityTrend,
  type QualityTrendBucket,
} from '@/lib/queries/quality-trend'
import {
  getLatestDsRunReport,
  countAnnotationsSinceLatestDsRun,
  type DsRunReport,
} from '@/lib/queries/dawid-skene'
import { QualityTrendPanel } from '@/components/quality/quality-trend-panel'
import { DawidSkeneSection } from '@/components/quality/dawid-skene-section'
import { PairIaaQualitySection } from '@/components/quality/pair-iaa-quality-section'
import { CriticalViolationsSection } from '@/components/quality/critical-violations-section'
import { ElapsedTimesSection } from '@/components/quality/elapsed-times-section'
import { GoldStandardsSection } from '@/components/quality/gold-standards-section'
import { CalibrationLeaderboard } from '@/components/quality/calibration-leaderboard'
import { TrustLeaderboard } from '@/components/quality/trust-leaderboard'

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
  const [
    golds,
    calibration,
    trust,
    violations,
    times,
    pairIaa,
    trend,
    dsReport,
    dsFreshness,
  ] = await Promise.all([
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
    getLatestDsRunReport(workspaceId).catch(() => null as DsRunReport | null),
    countAnnotationsSinceLatestDsRun({
      workspaceId,
      templateMode,
    }).catch(() => ({
      hasRun: false,
      newSubmissions: 0,
      runCreatedAt: null as Date | null,
    })),
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
      {/* Dawid-Skene EM truth inference — only for pair/arena (the modes
          whose payload encodes per-cell votes that DS can consume). */}
      {isPairOrArena && (
        <DawidSkeneSection
          workspaceId={workspaceId}
          initial={dsReport}
          newSubmissionsSince={dsFreshness.newSubmissions}
        />
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
      <TrustLeaderboard workspaceId={workspaceId} rows={trust} />
    </div>
  )
}
