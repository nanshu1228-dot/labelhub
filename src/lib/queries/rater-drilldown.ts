import 'server-only'
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  stepAnnotations,
  tasks,
  topics,
  trajectories,
  trajectorySteps,
  users,
} from '@/lib/db/schema'

/**
 * Per-rater drill-down: where does this user agree with consensus, and
 * where do they drift?
 *
 * For agent-trace-eval the drill axis is per-step-kind rubric (likert /
 * bool). For pair-rubric / arena-gsb the drill axis is the user's
 * per-rubric / per-dimension alignment vs majority/median of peers.
 *
 * Both modes share the same output shape so the UI can render a single
 * table: rows of `{ axisLabel, aligned, diverged, score }`.
 *
 * The pair/arena path mirrors trust-consensus's getWorkspacePairPeerTrust
 * but groups by (rubricId|dimId) instead of by user. This is the
 * "calibration drill-down" that closes the loop for admins.
 */

const PEER_TOLERANCE = 1
const PRIOR_ALPHA = 2.5
const PRIOR_BETA = 2.5

function smoothed(positives: number, negatives: number): number {
  return (
    (positives + PRIOR_ALPHA) /
    (positives + negatives + PRIOR_ALPHA + PRIOR_BETA)
  )
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export interface RaterAxisRow {
  /** Stable axis id — rubric/dim id for pair/arena; step kind for traj. */
  axisId: string
  /** Human display label. Same as axisId for now; future: pull names from template. */
  axisLabel: string
  /** This user's alignment events on this axis. */
  aligned: number
  diverged: number
  unilateral: number
  /** Bayesian-smoothed alignment rate in [0, 1]. */
  score: number
}

/**
 * Time-on-task summary for one rater × one workspace. Populated from
 * the durationSec column (post-time-tracking rollout) — falls back to
 * the startedAt/submittedAt pair when durationSec is null. Annotations
 * without either signal are excluded from coverage but reported as
 * `unknownCount` so the UI is honest about sample size.
 */
export interface RaterSpeedStats {
  /** How many of this rater's submissions have a usable duration. */
  measuredCount: number
  /** Submissions with no duration data (legacy or interrupted). */
  unknownCount: number
  /** Median seconds across measured submissions. */
  medianSec: number | null
  /** 10th-percentile seconds — useful for spotting "5 second" outliers. */
  p10Sec: number | null
  /** 90th-percentile seconds — useful for spotting "stuck for 10 minutes". */
  p90Sec: number | null
  /** Number of submissions flagged as suspiciously fast (< 10s). The
   *  threshold is hard-coded; per-task economy thresholds live in
   *  annotation-time.ts for the bulk-table flag column. */
  suspiciouslyFastCount: number
}

export interface RaterDrilldown {
  userId: string
  displayName: string | null
  email: string | null
  /** Admin-source data: how many of their submissions were approved/rejected. */
  approved: number
  rejected: number
  /** Per-axis peer-alignment breakdown (drill rows). */
  axes: RaterAxisRow[]
  /** Total annotations submitted in this workspace. */
  totalSubmitted: number
  /** Speed-of-work summary — surfaces water-army patterns. */
  speed: RaterSpeedStats
}

const SUSPICIOUSLY_FAST_SEC = 10

function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null
  const s = [...arr].sort((a, b) => a - b)
  const idx = Math.min(
    s.length - 1,
    Math.max(0, Math.floor((p / 100) * (s.length - 1))),
  )
  return s[idx]
}

/**
 * Compute drill-down for one user × one workspace. Works for every
 * templateMode — fans the peer-alignment compute across both
 * step_annotations (trajectory) and annotations.payload (pair / arena)
 * so we get a unified per-axis view.
 */
export async function getRaterDrilldown(opts: {
  userId: string
  workspaceId: string
}): Promise<RaterDrilldown | null> {
  const db = getDb()

  // 1. Resolve the user row.
  const [user] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, opts.userId))
    .limit(1)
  if (!user) return null

  // 2. Admin-source totals — approve/reject events for this user as
  //    submitter.
  const verdictEvents = await db
    .select({ type: events.type, payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.workspaceId, opts.workspaceId),
        inArray(events.type, ['annotation.approved', 'annotation.rejected']),
      ),
    )
  let approved = 0
  let rejected = 0
  for (const v of verdictEvents) {
    const p = (v.payload ?? {}) as Record<string, unknown>
    if (p.submitterUserId !== opts.userId) continue
    if (v.type === 'annotation.approved') approved++
    else rejected++
  }

  // 3. Per-axis peer alignment — pair/arena path.
  const pairRows = await db
    .select({
      annotationId: annotations.id,
      userId: annotations.userId,
      topicId: annotations.topicId,
      templateMode: tasks.templateMode,
      payload: annotations.payload,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .where(
      and(
        eq(tasks.workspaceId, opts.workspaceId),
        isNotNull(annotations.submittedAt),
        or(
          eq(tasks.templateMode, 'pair-rubric'),
          eq(tasks.templateMode, 'arena-gsb'),
        ),
      ),
    )

  // Dedup by (topic, user) — keep latest submission.
  type Row = (typeof pairRows)[number]
  const latestByUser = new Map<string, Row>()
  for (const r of pairRows) {
    const k = `${r.topicId}|${r.userId}`
    const prev = latestByUser.get(k)
    if (!prev || r.annotationId > prev.annotationId) latestByUser.set(k, r)
  }

  type Bucket = {
    cells: Array<
      | { kind: 'bool'; userId: string; value: boolean }
      | { kind: 'num'; userId: string; value: number }
    >
  }
  const bucket = new Map<string, Bucket>()

  for (const r of latestByUser.values()) {
    const payload = (r.payload ?? {}) as Record<string, unknown>
    if (r.templateMode === 'pair-rubric') {
      const ratings = (payload.ratings ?? {}) as Record<
        string,
        { a?: unknown; b?: unknown }
      >
      for (const [rubricId, v] of Object.entries(ratings)) {
        if (typeof v.a === 'boolean') {
          const key = `pair|${rubricId}|a`
          const b = bucket.get(`${r.topicId}|${key}`) ?? { cells: [] }
          b.cells.push({ kind: 'bool', userId: r.userId, value: v.a })
          bucket.set(`${r.topicId}|${key}`, b)
        }
        if (typeof v.b === 'boolean') {
          const key = `pair|${rubricId}|b`
          const b = bucket.get(`${r.topicId}|${key}`) ?? { cells: [] }
          b.cells.push({ kind: 'bool', userId: r.userId, value: v.b })
          bucket.set(`${r.topicId}|${key}`, b)
        }
      }
    } else if (r.templateMode === 'arena-gsb') {
      const dims = (payload.dimensions ?? {}) as Record<
        string,
        { a?: unknown; b?: unknown }
      >
      for (const [dimId, v] of Object.entries(dims)) {
        if (typeof v.a === 'number') {
          const key = `arena|${dimId}|a`
          const b = bucket.get(`${r.topicId}|${key}`) ?? { cells: [] }
          b.cells.push({ kind: 'num', userId: r.userId, value: v.a })
          bucket.set(`${r.topicId}|${key}`, b)
        }
        if (typeof v.b === 'number') {
          const key = `arena|${dimId}|b`
          const b = bucket.get(`${r.topicId}|${key}`) ?? { cells: [] }
          b.cells.push({ kind: 'num', userId: r.userId, value: v.b })
          bucket.set(`${r.topicId}|${key}`, b)
        }
      }
    }
  }

  // Per (rubricId|dimId) accumulator across topics.
  type AxisAcc = { aligned: number; diverged: number; unilateral: number }
  const axisAcc = new Map<string, AxisAcc>()
  const initAxis = (key: string): AxisAcc => {
    const e = axisAcc.get(key)
    if (e) return e
    const fresh: AxisAcc = { aligned: 0, diverged: 0, unilateral: 0 }
    axisAcc.set(key, fresh)
    return fresh
  }

  for (const [topicKey, b] of bucket) {
    const axisKey = topicKey.split('|').slice(1).join('|') // strip topicId prefix
    const myCell = b.cells.find((c) => c.userId === opts.userId)
    if (!myCell) continue
    const others = b.cells.filter((c) => c.userId !== opts.userId)
    if (others.length === 0) {
      initAxis(axisKey).unilateral++
      continue
    }
    const acc = initAxis(axisKey)
    if (myCell.kind === 'bool') {
      const trueCount = others.filter(
        (o) => o.kind === 'bool' && o.value === true,
      ).length
      const falseCount = others.length - trueCount
      if (trueCount === falseCount) {
        acc.unilateral++
        continue
      }
      const majority = trueCount > falseCount
      if (myCell.value === majority) acc.aligned++
      else acc.diverged++
    } else {
      const nums = others
        .map((o) => (o.kind === 'num' ? o.value : null))
        .filter((x): x is number => x !== null)
      if (nums.length === 0) {
        acc.unilateral++
        continue
      }
      const m = median(nums)
      if (Math.abs(myCell.value - m) <= PEER_TOLERANCE) acc.aligned++
      else acc.diverged++
    }
  }

  // 4. Per-step-kind trajectory alignment — same idea on step_annotations.
  // Group all step_annotations in the workspace by (trajectoryStepId, kind),
  // see who rated, compute this user's alignment per step kind.
  type StepRow = {
    stepId: string
    stepKind: string
    userId: string
    rating: number | null
  }
  const stepRows: StepRow[] = await db
    .select({
      stepId: stepAnnotations.trajectoryStepId,
      stepKind: trajectorySteps.kind,
      userId: annotations.userId,
      rating: stepAnnotations.rating,
    })
    .from(stepAnnotations)
    .innerJoin(
      trajectorySteps,
      eq(trajectorySteps.id, stepAnnotations.trajectoryStepId),
    )
    .innerJoin(
      trajectories,
      eq(trajectories.id, trajectorySteps.trajectoryId),
    )
    .innerJoin(annotations, eq(stepAnnotations.annotationId, annotations.id))
    .where(
      and(
        eq(trajectories.workspaceId, opts.workspaceId),
        eq(stepAnnotations.kind, 'step_quality'),
      ),
    )

  type StepBucket = { ratings: Array<{ userId: string; rating: number }>; kind: string }
  const stepBuckets = new Map<string, StepBucket>()
  for (const s of stepRows) {
    if (s.rating == null) continue
    const b = stepBuckets.get(s.stepId) ?? {
      ratings: [],
      kind: s.stepKind,
    }
    b.ratings.push({ userId: s.userId, rating: s.rating })
    stepBuckets.set(s.stepId, b)
  }
  for (const b of stepBuckets.values()) {
    const mine = b.ratings.find((r) => r.userId === opts.userId)
    if (!mine) continue
    const others = b.ratings
      .filter((r) => r.userId !== opts.userId)
      .map((r) => r.rating)
    const acc = initAxis(`traj|${b.kind}`)
    if (others.length === 0) {
      acc.unilateral++
      continue
    }
    const m = median(others)
    if (Math.abs(mine.rating - m) <= PEER_TOLERANCE) acc.aligned++
    else acc.diverged++
  }

  // 5. Format axes for the table.
  const axes: RaterAxisRow[] = []
  for (const [key, a] of axisAcc) {
    axes.push({
      axisId: key,
      axisLabel: key, // future: prettify with template's display name
      aligned: a.aligned,
      diverged: a.diverged,
      unilateral: a.unilateral,
      score: smoothed(a.aligned, a.diverged),
    })
  }
  axes.sort((a, b) => a.score - b.score) // worst first (drift surfaces top)

  // 6. Total submitted by this user across the workspace + speed stats.
  //    We pull durationSec and startedAt/submittedAt in the same query so
  //    we can derive speed in-process instead of a second roundtrip.
  const subRows = await db
    .select({
      id: annotations.id,
      durationSec: annotations.durationSec,
      startedAt: annotations.startedAt,
      submittedAt: annotations.submittedAt,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .where(
      and(
        eq(tasks.workspaceId, opts.workspaceId),
        eq(annotations.userId, opts.userId),
        isNotNull(annotations.submittedAt),
      ),
    )

  const durations: number[] = []
  let unknownCount = 0
  for (const r of subRows) {
    if (r.durationSec != null) {
      durations.push(r.durationSec)
    } else if (r.startedAt && r.submittedAt) {
      const sec = Math.max(
        0,
        Math.round((r.submittedAt.getTime() - r.startedAt.getTime()) / 1000),
      )
      durations.push(sec)
    } else {
      unknownCount++
    }
  }
  const sortedAsc = [...durations].sort((a, b) => a - b)
  const speed: RaterSpeedStats = {
    measuredCount: durations.length,
    unknownCount,
    medianSec:
      sortedAsc.length > 0
        ? sortedAsc[Math.floor(sortedAsc.length / 2)]
        : null,
    p10Sec: percentile(durations, 10),
    p90Sec: percentile(durations, 90),
    suspiciouslyFastCount: durations.filter(
      (d) => d < SUSPICIOUSLY_FAST_SEC,
    ).length,
  }

  return {
    userId: user.id,
    displayName: user.displayName ?? null,
    email: user.email ?? null,
    approved,
    rejected,
    axes,
    totalSubmitted: subRows.length,
    speed,
  }
}
