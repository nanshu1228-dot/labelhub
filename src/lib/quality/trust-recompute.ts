import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events, trustScores } from '@/lib/db/schema'

/**
 * Phase-9 trust persistence.
 *
 * Recompute and materialize the trust score for one (user, workspace,
 * taskType). Triggered after every verdict — approve / reject / qc-pass
 * / qc-request-revision — via `after()` so the user-facing action
 * stays fast. Failures here NEVER bubble up to the verdict: the worst
 * case is a stale trust row, which the live query layer still handles.
 *
 * Math:
 *   1. Pull verdict events for this user × workspace × taskType from
 *      the events table (denormalized payload carries submitterUserId,
 *      taskId, templateMode).
 *   2. Compute Bayesian-smoothed raw rate (α=β=2.5 — matches the
 *      existing trust-consensus reader).
 *   3. Compute EWMA-weighted decay rate with 14-day half-life.
 *      Verdicts older than ~60 days contribute < 5%.
 *   4. UPSERT into trust_scores keyed by the new unique
 *      (user_id, workspace_id, task_type) index.
 *
 * Why EWMA on top of raw rate: a previously-trusted rater who starts
 * drifting will see decayedScore fall faster than score does — admin
 * watches the gap as a leading-indicator of drift.
 */

const PRIOR_ALPHA = 2.5
const PRIOR_BETA = 2.5
/** 14-day half-life. ln(2) / 14 ≈ 0.0495 per day decay constant. */
const HALF_LIFE_DAYS = 14
const DECAY_LAMBDA = Math.log(2) / HALF_LIFE_DAYS

export interface RecomputedTrust {
  score: number
  decayedScore: number
  approvedCount: number
  rejectedCount: number
  sampleCount: number
}

/**
 * Re-derive trust from the events log + persist. Idempotent — calling
 * twice in a row produces the same row state.
 */
export async function recomputeAndPersistTrust(opts: {
  userId: string
  workspaceId: string
  taskType: string
}): Promise<RecomputedTrust> {
  const db = getDb()

  // Pull verdict events where this user was the submitter. The
  // approve/reject paths denormalize submitterUserId + taskId +
  // templateMode into the payload, so a single ORDER BY ts query
  // suffices.
  const rows = await db
    .select({
      type: events.type,
      ts: events.ts,
      payload: events.payload,
    })
    .from(events)
    .where(
      and(
        eq(events.workspaceId, opts.workspaceId),
        // The ->> ext operator extracts payload field as text;
        // matches the same pattern used in respondToReview's reviewer
        // lookup.
        sql`${events.payload} ->> 'submitterUserId' = ${opts.userId}`,
        sql`${events.payload} ->> 'templateMode' = ${opts.taskType}`,
        sql`${events.type} IN ('annotation.approved', 'annotation.rejected', 'annotation.revised', 'annotation.qc_passed')`,
      ),
    )

  let approved = 0
  let rejected = 0
  let weightedApproved = 0
  let weightedRejected = 0
  const now = Date.now()
  for (const r of rows) {
    // qc_passed counts as a 'positive' (the work passed QC even if
    // admin hasn't accepted yet). Revised / rejected count as
    // negative. This mirrors the live-query reader's bucketing.
    const positive =
      r.type === 'annotation.approved' || r.type === 'annotation.qc_passed'
    const negative =
      r.type === 'annotation.rejected' || r.type === 'annotation.revised'
    if (!positive && !negative) continue
    const ageDays = Math.max(
      0,
      (now - new Date(r.ts).getTime()) / (24 * 3600 * 1000),
    )
    const weight = Math.exp(-DECAY_LAMBDA * ageDays)
    if (positive) {
      approved += 1
      weightedApproved += weight
    } else {
      rejected += 1
      weightedRejected += weight
    }
  }

  const sampleCount = approved + rejected
  const score =
    (approved + PRIOR_ALPHA) /
    (sampleCount + PRIOR_ALPHA + PRIOR_BETA)
  const weightedSample = weightedApproved + weightedRejected
  const decayedScore =
    weightedSample === 0
      ? score
      : (weightedApproved + PRIOR_ALPHA) /
        (weightedSample + PRIOR_ALPHA + PRIOR_BETA)

  // UPSERT keyed by (user, workspace, taskType). The unique index
  // makes onConflictDoUpdate cheap. We don't track lastEventId yet
  // — full recompute on every verdict is fine at current scale and
  // makes the math trivially auditable.
  await db
    .insert(trustScores)
    .values({
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      taskType: opts.taskType,
      score,
      decayedScore,
      approvedCount: approved,
      rejectedCount: rejected,
      sampleCount,
      lastUpdated: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        trustScores.userId,
        trustScores.workspaceId,
        trustScores.taskType,
      ],
      set: {
        score,
        decayedScore,
        approvedCount: approved,
        rejectedCount: rejected,
        sampleCount,
        lastUpdated: new Date(),
      },
    })

  return {
    score,
    decayedScore,
    approvedCount: approved,
    rejectedCount: rejected,
    sampleCount,
  }
}

/**
 * Read the persisted trust row. Returns null when one doesn't exist
 * yet — readers should fall back to the live-derived value from
 * `trust-consensus.ts` in that case.
 */
export async function readPersistedTrust(opts: {
  userId: string
  workspaceId: string
  taskType: string
}): Promise<RecomputedTrust | null> {
  const db = getDb()
  const [row] = await db
    .select({
      score: trustScores.score,
      decayedScore: trustScores.decayedScore,
      approvedCount: trustScores.approvedCount,
      rejectedCount: trustScores.rejectedCount,
      sampleCount: trustScores.sampleCount,
    })
    .from(trustScores)
    .where(
      and(
        eq(trustScores.userId, opts.userId),
        eq(trustScores.workspaceId, opts.workspaceId),
        eq(trustScores.taskType, opts.taskType),
      ),
    )
    .limit(1)
  if (!row) return null
  return {
    score: row.score,
    decayedScore: row.decayedScore ?? row.score,
    approvedCount: row.approvedCount,
    rejectedCount: row.rejectedCount,
    sampleCount: row.sampleCount,
  }
}
