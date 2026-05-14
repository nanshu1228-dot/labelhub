import 'server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  stepAnnotations,
  trajectories,
  trajectorySteps,
  users,
} from '@/lib/db/schema'

/**
 * Trust score per annotator.
 *
 * TWO sources, with admin verdict (authoritative) preferred over peer
 * consensus (derived signal):
 *
 *   1. **admin** — folds `annotation.approved` / `annotation.rejected` events
 *      written by `reviewAnnotation`. This is ground truth: the workspace
 *      owner accepted or rejected the work. Score = β-posterior over those
 *      verdicts (Bayesian smoothed α=β=2.5).
 *
 *   2. **peer** — for users who have annotated but haven't been admin-reviewed
 *      yet, we fall back to "did your rating align with the median of OTHER
 *      raters?" (±1 tolerance, same as IAA dispute detection). This is an
 *      EARLY signal — useful before review lands, but it's "consensus =
 *      correctness" which can be wrong if the consensus itself is wrong.
 *
 * The unified `getWorkspaceTrust` returns one row per user with `source`
 * tagged. The UI is expected to gate visibility (admin-only) and show the
 * source on hover so admins know whether they're looking at authority or
 * an estimate.
 *
 * Same α=β=2.5 prior across both sources so a brand-new user lands at 0.5
 * regardless of which signal kicks in first.
 */

const PRIOR_ALPHA = 2.5
const PRIOR_BETA = 2.5
const PEER_TOLERANCE = 1

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

// ─── Unified result type ──────────────────────────────────────────────────

/**
 * Discriminated union — `source` tells the UI whether it can claim authority
 * ("admin reviewed this many submissions") or has to caveat ("based on peer
 * consensus, no admin reviews yet").
 *
 * Both shapes carry the smoothed `score ∈ [0, 1]` and `displayName` so
 * components can render uniformly.
 */
export type UserTrust =
  | {
      source: 'admin'
      userId: string
      displayName: string | null
      /** Count of annotations the admin accepted. */
      approved: number
      /** Count of annotations the admin rejected. */
      rejected: number
      /** Bayesian-smoothed approval rate in [0, 1]. */
      score: number
    }
  | {
      source: 'peer'
      userId: string
      displayName: string | null
      /** Step-marks where this user agreed with the median of others (±1). */
      aligned: number
      /** Step-marks where this user diverged. */
      diverged: number
      /** Step-marks where this user was the only rater (no comparison possible). */
      unilateral: number
      /** Bayesian-smoothed consensus alignment in [0, 1]. */
      score: number
    }

// ─── Source 1: admin verdicts (the authoritative signal) ──────────────────

/**
 * Reads `annotation.approved` / `annotation.rejected` events from the
 * workspace's event log and tallies approvals vs. rejections per submitter.
 *
 * `reviewAnnotation` denormalizes `payload.submitterUserId` so this query
 * can group without joining back to annotations — keeps the read cheap.
 *
 * Returns one row per user that has at least one verdict. Users with zero
 * verdicts simply don't appear here (the caller can fall back to peer).
 */
export async function getWorkspaceApprovalTrust(
  workspaceId: string,
): Promise<
  Extract<UserTrust, { source: 'admin' }>[]
> {
  const db = getDb()

  const verdicts = await db
    .select({
      type: events.type,
      payload: events.payload,
    })
    .from(events)
    .where(
      and(
        eq(events.workspaceId, workspaceId),
        inArray(events.type, ['annotation.approved', 'annotation.rejected']),
      ),
    )

  type Tally = { approved: number; rejected: number }
  const byUser = new Map<string, Tally>()
  for (const v of verdicts) {
    const p = (v.payload ?? {}) as Record<string, unknown>
    const submitterId = p.submitterUserId
    if (typeof submitterId !== 'string') continue
    const t = byUser.get(submitterId) ?? { approved: 0, rejected: 0 }
    if (v.type === 'annotation.approved') t.approved++
    else t.rejected++
    byUser.set(submitterId, t)
  }

  if (byUser.size === 0) return []

  // Backfill displayName.
  const userRows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, [...byUser.keys()]))
  const nameById = new Map(userRows.map((u) => [u.id, u.displayName]))

  const out: Extract<UserTrust, { source: 'admin' }>[] = []
  for (const [userId, t] of byUser) {
    out.push({
      source: 'admin',
      userId,
      displayName: nameById.get(userId) ?? null,
      approved: t.approved,
      rejected: t.rejected,
      score: smoothed(t.approved, t.rejected),
    })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

// ─── Source 2: peer consensus (early/secondary signal) ───────────────────

/**
 * Peer-consensus trust — for every step a user rated where at least 2 raters
 * were present, asks "did the user's rating align with the MEDIAN of the
 * other raters?" (within ±1 rating point — same tolerance as IAA dispute
 * detection). Bayesian-smoothed over those alignment events.
 *
 * Why median-of-others (not majority): with 3 raters split 5/3/1, "majority"
 * is undefined. Median is well-defined and stable; the user being judged is
 * excluded so they can't trivially boost themselves.
 *
 * Cost: workspace-scoped scan of step_annotations joined to trajectory_steps
 * + trajectories. Tens to low thousands of rows for MVP scale.
 */
export async function getWorkspacePeerTrust(
  workspaceId: string,
): Promise<Extract<UserTrust, { source: 'peer' }>[]> {
  const db = getDb()
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

  type Accum = {
    aligned: number
    diverged: number
    unilateral: number
    displayName: string | null
  }
  const byUser = new Map<string, Accum>()
  const initAcc = (userId: string, displayName: string | null): Accum => {
    const existing = byUser.get(userId)
    if (existing) return existing
    const a: Accum = { aligned: 0, diverged: 0, unilateral: 0, displayName }
    byUser.set(userId, a)
    return a
  }

  for (const bucket of byStep.values()) {
    if (bucket.raters.length < 2) {
      // Single rater: counted as unilateral (no peer signal).
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
      if (Math.abs(r.rating - m) <= PEER_TOLERANCE) acc.aligned++
      else acc.diverged++
    }
  }

  const out: Extract<UserTrust, { source: 'peer' }>[] = []
  for (const [userId, a] of byUser) {
    out.push({
      source: 'peer',
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

// ─── Unified query: admin preferred, peer fallback ────────────────────────

/**
 * Merge admin verdicts (preferred) with peer consensus (fallback) into one
 * row per user. A user that has any admin verdict appears with source='admin';
 * a user that only has peer marks (or solo unilateral marks) appears with
 * source='peer'.
 *
 * The UI should gate visibility on isAdmin — these scores are operational
 * intelligence, not annotator-facing data.
 */
export async function getWorkspaceTrust(
  workspaceId: string,
): Promise<UserTrust[]> {
  const [adminScores, peerScores] = await Promise.all([
    getWorkspaceApprovalTrust(workspaceId),
    getWorkspacePeerTrust(workspaceId),
  ])
  const byUser = new Map<string, UserTrust>()
  // Seed with peer first; admin overrides.
  for (const p of peerScores) byUser.set(p.userId, p)
  for (const a of adminScores) byUser.set(a.userId, a)
  return [...byUser.values()].sort((a, b) => b.score - a.score)
}

/**
 * Back-compat alias. Prefer `getWorkspaceTrust` for new code.
 * @deprecated use `getWorkspaceTrust` (or `getWorkspacePeerTrust` for the
 * old peer-only behavior).
 */
export const getWorkspaceTrustScores = getWorkspaceTrust

// ─── Self-data for /my/earnings — COLD COUNTS, no score ───────────────────

/**
 * Cold contribution counts for an annotator. Returns the raw numbers
 * (submitted / approved / rejected) WITHOUT a smoothed score, because
 * showing annotators a gamified score creates perverse incentives.
 * They see what they actually did — admins judge quality privately.
 *
 * `pendingReview` = submitted but not yet admin-reviewed.
 */
export interface MyContribution {
  submitted: number
  approved: number
  rejected: number
  pendingReview: number
}

export async function getMyContribution(opts: {
  userId: string
  /** Optional workspace scope. Omit to count across all workspaces. */
  workspaceId?: string
}): Promise<MyContribution> {
  const db = getDb()

  // Count submitted annotations from events: annotation.submitted with this
  // user as the actor. Cheaper than scanning the annotations table because
  // events is append-only and indexed on workspace.
  const submittedRow = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(
      and(
        eq(events.type, 'annotation.submitted'),
        eq(events.actorId, opts.userId),
        opts.workspaceId ? eq(events.workspaceId, opts.workspaceId) : sql`true`,
      ),
    )

  // Approved + rejected: need to filter on payload.submitterUserId because
  // those events have the REVIEWER as actor.
  const verdictRows = await db
    .select({ type: events.type, payload: events.payload })
    .from(events)
    .where(
      and(
        inArray(events.type, ['annotation.approved', 'annotation.rejected']),
        opts.workspaceId ? eq(events.workspaceId, opts.workspaceId) : sql`true`,
      ),
    )
  let approved = 0
  let rejected = 0
  for (const v of verdictRows) {
    const p = (v.payload ?? {}) as Record<string, unknown>
    if (p.submitterUserId !== opts.userId) continue
    if (v.type === 'annotation.approved') approved++
    else rejected++
  }

  const submitted = Number(submittedRow[0]?.n ?? 0)
  return {
    submitted,
    approved,
    rejected,
    pendingReview: Math.max(0, submitted - approved - rejected),
  }
}

/**
 * Trust score for a single user, scoped to a workspace. Used by admin UI
 * (e.g. trajectory detail page showing the rater of each mark).
 *
 * Returns null when the user has no annotation activity at all.
 */
export async function getUserTrust(opts: {
  workspaceId: string
  userId: string
}): Promise<UserTrust | null> {
  const all = await getWorkspaceTrust(opts.workspaceId)
  return all.find((u) => u.userId === opts.userId) ?? null
}
