import 'server-only'
import { getWorkspaceIaaSummary } from './iaa'
import { getWorkspaceTrust } from './trust-consensus'
import {
  getWorkspaceCalibration,
  listWorkspaceGoldStandards,
} from './gold-standards'
import { listWorkspaceCriticalViolations } from './critical-violations'
import { getMyContribution } from './trust-consensus'

/**
 * Customer-facing quality summary for `GET /api/quality/summary`.
 *
 * Single roll-up that gives an integrator everything they need to:
 *   - Show "quality of this annotation batch" on their side
 *   - Filter trajectories that crossed critical-rubric thresholds
 *   - Snapshot rater performance for their own dashboards
 *
 * Internally fans out to existing query helpers — no new DB work, just a
 * stable API contract on top.
 */

export interface ApiQualitySummaryRater {
  userId: string
  email: string | null
  displayName: string | null
  trust: {
    /** 'admin' (verdict-derived) or 'peer' (consensus-derived). */
    source: 'admin' | 'peer'
    /** Bayesian-smoothed score in [0, 1]. */
    score: number
    /** Positive count: admin-approved or peer-aligned. */
    positives: number
    /** Negative count: admin-rejected or peer-diverged. */
    negatives: number
  } | null
  calibration: {
    /** vs gold standards. */
    matched: number
    diverged: number
    score: number
    goldsCovered: number
  } | null
  contribution: {
    submitted: number
    approved: number
    rejected: number
    pendingReview: number
  }
}

export interface ApiQualitySummary {
  workspaceId: string
  asOf: string // ISO
  iaa: {
    annotatedSteps: number
    multiRaterSteps: number
    disputedSteps: number
    /** [0, 1] or null when insufficient data. */
    agreementRate: number | null
  }
  raterCount: number
  raters: ApiQualitySummaryRater[]
  goldStandards: {
    count: number
    items: Array<{
      id: string
      trajectoryId: string
      promotedByUserId: string
      promotedByDisplayName: string | null
      promotedAt: string
      rubricCount: number
    }>
  }
  criticalViolations: {
    count: number
    /** Up to 10 most recent. */
    recent: Array<{
      trajectoryId: string
      rubricId: string
      rubricName: string
      raterId: string
      raterDisplayName: string | null
      ts: string
    }>
  }
}

export async function getQualitySummaryForApi(
  workspaceId: string,
): Promise<ApiQualitySummary> {
  const [iaa, trustList, calibration, golds, violations] = await Promise.all([
    getWorkspaceIaaSummary(workspaceId),
    getWorkspaceTrust(workspaceId).catch(() => []),
    getWorkspaceCalibration(workspaceId).catch(() => []),
    listWorkspaceGoldStandards(workspaceId).catch(() => []),
    listWorkspaceCriticalViolations(workspaceId).catch(() => []),
  ])

  const calibrationByUser = new Map(
    calibration.map((c) => [c.userId, c]),
  )

  // Build per-rater contribution counts in parallel.
  const raters: ApiQualitySummaryRater[] = await Promise.all(
    trustList.map(async (t) => {
      const contribution = await getMyContribution({
        userId: t.userId,
        workspaceId,
      })
      const c = calibrationByUser.get(t.userId) ?? null
      return {
        userId: t.userId,
        email: null, // displayName preferred; email needs a lookup we skip to save round-trips
        displayName: t.displayName,
        trust:
          t.source === 'admin'
            ? {
                source: 'admin',
                score: round4(t.score),
                positives: t.approved,
                negatives: t.rejected,
              }
            : {
                source: 'peer',
                score: round4(t.score),
                positives: t.aligned,
                negatives: t.diverged,
              },
        calibration: c
          ? {
              matched: c.matched,
              diverged: c.diverged,
              score: round4(c.score),
              goldsCovered: c.goldsCovered,
            }
          : null,
        contribution,
      }
    }),
  )

  return {
    workspaceId,
    asOf: new Date().toISOString(),
    iaa: {
      annotatedSteps: iaa?.annotatedSteps ?? 0,
      multiRaterSteps: iaa?.multiRaterSteps ?? 0,
      disputedSteps: iaa?.disputedSteps ?? 0,
      agreementRate:
        iaa?.agreementRate != null ? round4(iaa.agreementRate) : null,
    },
    raterCount: raters.length,
    raters,
    goldStandards: {
      count: golds.length,
      items: golds.map((g) => ({
        id: g.id,
        trajectoryId: g.trajectoryId,
        promotedByUserId: g.promotedByUserId,
        promotedByDisplayName: g.promotedByDisplayName,
        promotedAt: g.promotedAt.toISOString(),
        rubricCount: g.rubricCount,
      })),
    },
    criticalViolations: {
      count: violations.length,
      recent: violations.slice(0, 10).map((v) => ({
        trajectoryId: v.trajectoryId,
        rubricId: v.rubricId,
        rubricName: v.rubricName,
        raterId: v.raterId,
        raterDisplayName: v.raterDisplayName,
        ts: v.ts.toISOString(),
      })),
    },
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
