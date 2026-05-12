import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  stepAnnotations,
  trajectories,
  trajectorySteps,
  users,
} from '@/lib/db/schema'

/**
 * Trust score per annotator — Bayesian-smoothed consensus alignment.
 *
 * For every step a user rated where at LEAST 2 raters were present, we ask:
 *   "Did this user's rating align with the MEDIAN of the other raters?"
 * (within ±1 rating point, same tolerance as our IAA dispute detection.)
 *
 * The trust score is then α=β=2.5-smoothed beta posterior over those
 * alignment events. A user with 0 sample points scores 0.5 (uncertain).
 * Same prior as the legacy `trust-projection.ts` so calibration is shared
 * across the platform.
 *
 * Why median-of-others (not majority): with 3 raters split 5/3/1, "majority"
 * is undefined. Median is well-defined and stable; the user being judged
 * is excluded so they can't trivially boost themselves.
 *
 * Cost: workspace-scoped scan of step_annotations joined to trajectory_steps
 * + trajectories. Bucket entirely in JS — tens to low thousands of rows.
 * The query is bounded by total annotation volume per workspace, not user
 * count. Cheap for MVP.
 */

const PRIOR_ALPHA = 2.5
const PRIOR_BETA = 2.5
const TOLERANCE = 1

function smoothed(approved: number, rejected: number): number {
  return (
    (approved + PRIOR_ALPHA) /
    (approved + rejected + PRIOR_ALPHA + PRIOR_BETA)
  )
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export interface UserTrust {
  userId: string
  displayName: string | null
  aligned: number
  diverged: number
  /** Steps where the user rated but no other raters present (no signal). */
  unilateral: number
  /** Bayesian-smoothed score in [0, 1]. */
  score: number
}

/**
 * Compute trust per user in a workspace. Returns one row per user that has
 * at least one step annotation; sorted by score descending.
 */
export async function getWorkspaceTrustScores(
  workspaceId: string,
): Promise<UserTrust[]> {
  const db = getDb()
  // Pull all step_quality marks in the workspace + rater identity.
  const rows = await db
    .select({
      stepId: stepAnnotations.trajectoryStepId,
      userId: annotations.userId,
      displayName: users.displayName,
      rating: stepAnnotations.rating,
    })
    .from(stepAnnotations)
    .innerJoin(
      trajectorySteps,
      eq(stepAnnotations.trajectoryStepId, trajectorySteps.id),
    )
    .innerJoin(
      trajectories,
      eq(trajectorySteps.trajectoryId, trajectories.id),
    )
    .innerJoin(annotations, eq(stepAnnotations.annotationId, annotations.id))
    .innerJoin(users, eq(annotations.userId, users.id))
    .where(
      and(
        eq(trajectories.workspaceId, workspaceId),
        isNull(trajectories.deletedAt),
        eq(stepAnnotations.kind, 'step_quality'),
      ),
    )

  // Group by step.
  type StepBucket = {
    raters: Array<{ userId: string; rating: number; displayName: string | null }>
  }
  const byStep = new Map<string, StepBucket>()
  for (const r of rows) {
    if (r.rating == null) continue
    const b = byStep.get(r.stepId) ?? { raters: [] }
    b.raters.push({
      userId: r.userId,
      rating: r.rating,
      displayName: r.displayName,
    })
    byStep.set(r.stepId, b)
  }

  // For each step with ≥2 raters, score every rater's alignment with the
  // median-of-others.
  type Accum = {
    aligned: number
    diverged: number
    unilateral: number
    displayName: string | null
  }
  const byUser = new Map<string, Accum>()
  const initAcc = (
    userId: string,
    displayName: string | null,
  ): Accum =>
    byUser.get(userId) ??
    (() => {
      const a: Accum = {
        aligned: 0,
        diverged: 0,
        unilateral: 0,
        displayName,
      }
      byUser.set(userId, a)
      return a
    })()

  for (const bucket of byStep.values()) {
    if (bucket.raters.length < 2) {
      // Single rater: tracked as unilateral so the UI can show "rated X
      // steps, N had peers" honestly.
      for (const r of bucket.raters) {
        initAcc(r.userId, r.displayName).unilateral++
      }
      continue
    }
    for (const r of bucket.raters) {
      const others = bucket.raters
        .filter((o) => o.userId !== r.userId)
        .map((o) => o.rating)
      const m = median(others)
      const acc = initAcc(r.userId, r.displayName)
      if (Math.abs(r.rating - m) <= TOLERANCE) acc.aligned++
      else acc.diverged++
    }
  }

  const out: UserTrust[] = []
  for (const [userId, a] of byUser) {
    out.push({
      userId,
      displayName: a.displayName,
      aligned: a.aligned,
      diverged: a.diverged,
      unilateral: a.unilateral,
      score: smoothed(a.aligned, a.diverged),
    })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

/**
 * Trust score for a single user, scoped to a workspace.
 *
 * Convenience wrapper. Returns null when the user has no marks at all
 * (different from "0.5 baseline" — distinguishes "new" from "neutral").
 */
export async function getUserTrust(opts: {
  workspaceId: string
  userId: string
}): Promise<UserTrust | null> {
  const all = await getWorkspaceTrustScores(opts.workspaceId)
  return all.find((u) => u.userId === opts.userId) ?? null
}
