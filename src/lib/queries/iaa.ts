import 'server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  stepAnnotations,
  topics,
  tasks,
  trajectories,
  trajectorySteps,
  users,
} from '@/lib/db/schema'
import { IAA_TOLERANCE, isDispute, ratingSpread } from './iaa-math'

/**
 * Inter-Annotator Agreement (IAA) — the second pillar of LabelHub.
 *
 * When ≥2 annotators rate the same step, this module surfaces:
 *   - exact ratings each gave
 *   - whether they agree or disagree
 *   - aggregate disagreement count per trajectory + per workspace
 *
 * This data drives:
 *   - "disputed step" badges on the trajectory list page
 *   - "annotators disagree" warnings on the detail page
 *   - the seed corpus for the AI Guideline Refiner (Round 3)
 *
 * Definition of agreement (for the `step_quality` kind):
 *   - All raters within ±1 rating-point → agreement
 *   - Otherwise → dispute
 * (Using a tolerance instead of strict equality avoids flagging 5 vs 5
 * as different when raters use the same scale; and 5 vs 1 is clearly
 * disputed while 5 vs 3 is "soft" — flagged but less severe.)
 *
 * Performance: a single trajectory rarely has >50 steps; aggregating
 * disputed counts across a workspace is one indexed query with a small
 * group-by. We don't materialize this — recompute on read.
 */

export interface RaterMark {
  userId: string
  displayName: string | null
  rating: number | null
  reasoning: string
  kind: string
}

export interface StepIAA {
  trajectoryStepId: string
  trajectoryId: string
  /** All raters with marks on this step (any kind). */
  raters: RaterMark[]
  /** True when raters disagree by more than ±1 rating point on `step_quality`. */
  disputed: boolean
  /** Severity: 0 (full agreement) … 4 (extreme: 5 vs 1). */
  spread: number
}

/**
 * Compute IAA for every step in a trajectory. Returns one StepIAA per step
 * that has ≥2 raters of the same kind; steps with 0 or 1 rater are skipped.
 */
export async function getTrajectoryIAA(
  trajectoryId: string,
): Promise<StepIAA[]> {
  const db = getDb()

  // Pull every step_annotation joined to the user, scoped to this trajectory.
  const marks = await db
    .select({
      trajectoryStepId: stepAnnotations.trajectoryStepId,
      userId: annotations.userId,
      displayName: users.displayName,
      rating: stepAnnotations.rating,
      reasoning: stepAnnotations.reasoning,
      kind: stepAnnotations.kind,
    })
    .from(stepAnnotations)
    .innerJoin(
      trajectorySteps,
      eq(stepAnnotations.trajectoryStepId, trajectorySteps.id),
    )
    .innerJoin(annotations, eq(stepAnnotations.annotationId, annotations.id))
    .innerJoin(users, eq(annotations.userId, users.id))
    .where(eq(trajectorySteps.trajectoryId, trajectoryId))

  // Group by step.
  const byStep = new Map<string, RaterMark[]>()
  for (const m of marks) {
    const arr = byStep.get(m.trajectoryStepId) ?? []
    arr.push({
      userId: m.userId,
      displayName: m.displayName,
      rating: m.rating,
      reasoning: m.reasoning,
      kind: m.kind,
    })
    byStep.set(m.trajectoryStepId, arr)
  }

  const out: StepIAA[] = []
  for (const [stepId, raters] of byStep) {
    if (raters.length < 2) continue
    // Compute spread on numeric ratings for step_quality kind only.
    const ratings = raters
      .filter((r) => r.kind === 'step_quality' && r.rating != null)
      .map((r) => r.rating!)
    const spread = ratingSpread(ratings)
    out.push({
      trajectoryStepId: stepId,
      trajectoryId,
      raters,
      disputed: isDispute(ratings),
      spread,
    })
  }
  return out
}

/**
 * Per-trajectory dispute count, for the list page badge. One indexed query.
 */
export async function listDisputeCountsByTrajectory(
  workspaceId: string,
  trajectoryIds: string[],
): Promise<Map<string, number>> {
  if (trajectoryIds.length === 0) return new Map()

  const db = getDb()
  // For each trajectory we want: number of steps where (a) ≥2 ratings exist
  // and (b) max-min > 1. Easiest correct path: pull all marks then bucket
  // in JS. Each trajectory rarely has >50 steps × few raters, so volume
  // stays tiny.
  const rows = await db
    .select({
      trajectoryId: trajectorySteps.trajectoryId,
      stepId: stepAnnotations.trajectoryStepId,
      rating: stepAnnotations.rating,
      kind: stepAnnotations.kind,
    })
    .from(stepAnnotations)
    .innerJoin(
      trajectorySteps,
      eq(stepAnnotations.trajectoryStepId, trajectorySteps.id),
    )
    .where(
      and(
        inArray(trajectorySteps.trajectoryId, trajectoryIds),
        eq(stepAnnotations.kind, 'step_quality'),
      ),
    )

  // Group: trajectoryId → stepId → ratings[]
  const byTraj = new Map<string, Map<string, number[]>>()
  for (const r of rows) {
    if (r.rating == null) continue
    const t = byTraj.get(r.trajectoryId) ?? new Map<string, number[]>()
    const arr = t.get(r.stepId) ?? []
    arr.push(r.rating)
    t.set(r.stepId, arr)
    byTraj.set(r.trajectoryId, t)
  }
  const out = new Map<string, number>()
  for (const [tid, stepMap] of byTraj) {
    let disputed = 0
    for (const arr of stepMap.values()) {
      if (isDispute(arr)) disputed++
    }
    if (disputed > 0) out.set(tid, disputed)
  }
  void workspaceId
  return out
}

/**
 * Workspace-level rollup: total annotated steps, of which N are disputed.
 * One scan over the same data. Plumbed into the workspace dashboard.
 */
export async function getWorkspaceIaaSummary(workspaceId: string): Promise<{
  annotatedSteps: number
  ratedSteps: number
  multiRaterSteps: number
  disputedSteps: number
  agreementRate: number | null
}> {
  const db = getDb()
  const rows = await db
    .select({
      stepId: stepAnnotations.trajectoryStepId,
      rating: stepAnnotations.rating,
      kind: stepAnnotations.kind,
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
    .where(
      and(
        eq(trajectories.workspaceId, workspaceId),
        isNull(trajectories.deletedAt),
      ),
    )

  const byStep = new Map<string, number[]>()
  for (const r of rows) {
    if (r.kind !== 'step_quality' || r.rating == null) continue
    const arr = byStep.get(r.stepId) ?? []
    arr.push(r.rating)
    byStep.set(r.stepId, arr)
  }
  let multi = 0
  let disputed = 0
  for (const arr of byStep.values()) {
    if (arr.length >= 2) {
      multi++
      if (isDispute(arr)) disputed++
    }
  }
  const agreementRate = multi === 0 ? null : 1 - disputed / multi
  return {
    annotatedSteps: byStep.size,
    ratedSteps: byStep.size,
    multiRaterSteps: multi,
    disputedSteps: disputed,
    agreementRate,
  }
}

/**
 * Top-N disputed steps across a workspace — used by the Guideline Refiner.
 * Returns full step + all raters' marks for each dispute.
 */
export async function listTopDisputes(opts: {
  workspaceId: string
  limit?: number
}): Promise<
  Array<{
    trajectoryId: string
    trajectoryStepId: string
    spread: number
    raters: RaterMark[]
  }>
> {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 20, 100)

  // Fetch all step_quality marks in the workspace with rater identity.
  const rows = await db
    .select({
      trajectoryId: trajectorySteps.trajectoryId,
      trajectoryStepId: stepAnnotations.trajectoryStepId,
      userId: annotations.userId,
      displayName: users.displayName,
      rating: stepAnnotations.rating,
      reasoning: stepAnnotations.reasoning,
      kind: stepAnnotations.kind,
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
        eq(trajectories.workspaceId, opts.workspaceId),
        isNull(trajectories.deletedAt),
        eq(stepAnnotations.kind, 'step_quality'),
      ),
    )

  // Bucket per step + score spread.
  type Bucket = { trajectoryId: string; raters: RaterMark[] }
  const byStep = new Map<string, Bucket>()
  for (const r of rows) {
    const b =
      byStep.get(r.trajectoryStepId) ??
      ({ trajectoryId: r.trajectoryId, raters: [] } satisfies Bucket)
    b.raters.push({
      userId: r.userId,
      displayName: r.displayName,
      rating: r.rating,
      reasoning: r.reasoning,
      kind: r.kind,
    })
    byStep.set(r.trajectoryStepId, b)
  }

  const disputes: Array<{
    trajectoryId: string
    trajectoryStepId: string
    spread: number
    raters: RaterMark[]
  }> = []
  for (const [stepId, b] of byStep) {
    if (b.raters.length < 2) continue
    const nums = b.raters
      .map((r) => r.rating)
      .filter((x): x is number => x != null)
    if (nums.length < 2) continue
    const spread = ratingSpread(nums)
    if (spread <= IAA_TOLERANCE) continue
    disputes.push({
      trajectoryId: b.trajectoryId,
      trajectoryStepId: stepId,
      spread,
      raters: b.raters,
    })
  }
  disputes.sort((a, b) => b.spread - a.spread)

  void sql // keep import
  return disputes.slice(0, limit)
}
