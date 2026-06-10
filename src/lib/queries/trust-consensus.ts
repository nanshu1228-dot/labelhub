import 'server-only'
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
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
import {
  IAA_TOLERANCE,
  betaPosteriorMean,
  majorityBoolean,
  median,
  withinTolerance,
} from './iaa-math'

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
/**
 * Peer-alignment tolerance — the SAME ±1 used by IAA dispute detection.
 * Aliased to the canonical `IAA_TOLERANCE` so there is one knob, not two.
 */
const PEER_TOLERANCE = IAA_TOLERANCE

/**
 * Bayesian-smoothed rate. Delegates to the canonical `betaPosteriorMean`
 * kernel so the β-posterior formula lives in exactly one place; the α=β=2.5
 * prior is the documented default for this module.
 */
function smoothed(positives: number, negatives: number): number {
  return betaPosteriorMean(positives, negatives, {
    alpha: PRIOR_ALPHA,
    beta: PRIOR_BETA,
  })
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
      if (withinTolerance(r.rating, m, PEER_TOLERANCE)) acc.aligned++
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

// ─── Source 3: pair / arena peer consensus ───────────────────────────────

/**
 * Peer-consensus trust for the pair-rubric and arena-gsb modes.
 *
 * Trajectory peer trust reads step_annotations because trajectory marks
 * are one-rating-per-step. Pair / arena annotations are different: each
 * topic produces a payload with multiple (rubricId|dimId, side)
 * judgments. We treat each (rubricId|dimId, side) cell as one
 * alignment data point.
 *
 * Alignment rule per row:
 *   - pair-rubric  (boolean): rater aligned with the MAJORITY of others'
 *                              booleans on the same (rubricId, side).
 *                              Tie among others → unilateral (skipped).
 *   - arena-gsb    (1-5):     rater aligned when |their - median(others)| ≤ 1
 *                              (same tolerance as step_annotations peer trust).
 *
 * Same Bayesian prior as the trajectory peer source so the discriminated
 * union row stays uniform — UI doesn't care whether the peer signal came
 * from steps or from pair/arena payloads.
 */
export async function getWorkspacePairPeerTrust(
  workspaceId: string,
): Promise<Extract<UserTrust, { source: 'peer' }>[]> {
  const db = getDb()

  type Row = {
    annotationId: string
    userId: string
    displayName: string | null
    topicId: string
    templateMode: string
    payload: unknown
  }
  const rows: Row[] = await db
    .select({
      annotationId: annotations.id,
      userId: annotations.userId,
      displayName: users.displayName,
      topicId: annotations.topicId,
      templateMode: tasks.templateMode,
      payload: annotations.payload,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .innerJoin(users, eq(users.id, annotations.userId))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        isNotNull(annotations.submittedAt),
        or(
          eq(tasks.templateMode, 'pair-rubric'),
          eq(tasks.templateMode, 'arena-gsb'),
        ),
      ),
    )

  type Cell =
    | { kind: 'bool'; value: boolean }
    | { kind: 'num'; value: number }

  // Build per-(topicId, mode, dimOrRubricId, side) buckets so we can compute
  // peer consensus excluding the rater themselves.
  type BucketKey = string
  type CellEntry = {
    userId: string
    cell: Cell
    displayName: string | null
  }
  const bucket = new Map<BucketKey, CellEntry[]>()
  // De-duplicate to ONE annotation per (topic, user) — the latest one wins.
  // Submitted annotations are immutable, so dup-by-user shouldn't happen
  // in practice, but defensive: prefer the lexicographically last id.
  const dedupKey = (topicId: string, userId: string) =>
    `${topicId}|${userId}`
  const latestByUser = new Map<string, Row>()
  for (const r of rows) {
    const k = dedupKey(r.topicId, r.userId)
    const prev = latestByUser.get(k)
    if (!prev || r.annotationId > prev.annotationId) latestByUser.set(k, r)
  }

  for (const r of latestByUser.values()) {
    const payload = (r.payload ?? {}) as Record<string, unknown>

    if (r.templateMode === 'pair-rubric') {
      const ratings = (payload.ratings ?? {}) as Record<
        string,
        { a?: unknown; b?: unknown }
      >
      for (const [rubricId, v] of Object.entries(ratings)) {
        if (typeof v.a === 'boolean') {
          const key = `${r.topicId}|pair|${rubricId}|a`
          const list = bucket.get(key) ?? []
          list.push({
            userId: r.userId,
            cell: { kind: 'bool', value: v.a },
            displayName: r.displayName,
          })
          bucket.set(key, list)
        }
        if (typeof v.b === 'boolean') {
          const key = `${r.topicId}|pair|${rubricId}|b`
          const list = bucket.get(key) ?? []
          list.push({
            userId: r.userId,
            cell: { kind: 'bool', value: v.b },
            displayName: r.displayName,
          })
          bucket.set(key, list)
        }
      }
    } else if (r.templateMode === 'arena-gsb') {
      const dims = (payload.dimensions ?? {}) as Record<
        string,
        { a?: unknown; b?: unknown }
      >
      for (const [dimId, v] of Object.entries(dims)) {
        if (typeof v.a === 'number') {
          const key = `${r.topicId}|arena|${dimId}|a`
          const list = bucket.get(key) ?? []
          list.push({
            userId: r.userId,
            cell: { kind: 'num', value: v.a },
            displayName: r.displayName,
          })
          bucket.set(key, list)
        }
        if (typeof v.b === 'number') {
          const key = `${r.topicId}|arena|${dimId}|b`
          const list = bucket.get(key) ?? []
          list.push({
            userId: r.userId,
            cell: { kind: 'num', value: v.b },
            displayName: r.displayName,
          })
          bucket.set(key, list)
        }
      }
    }
  }

  // For each bucket, judge alignment for each member against the
  // majority/median of the OTHERS in the same bucket.
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
  ): Accum => {
    const existing = byUser.get(userId)
    if (existing) return existing
    const a: Accum = {
      aligned: 0,
      diverged: 0,
      unilateral: 0,
      displayName,
    }
    byUser.set(userId, a)
    return a
  }

  for (const list of bucket.values()) {
    if (list.length < 2) {
      for (const e of list) initAcc(e.userId, e.displayName).unilateral++
      continue
    }
    for (const e of list) {
      const others = list.filter((o) => o.userId !== e.userId)
      const acc = initAcc(e.userId, e.displayName)
      if (e.cell.kind === 'bool') {
        // Majority vote of the others' booleans.
        const trueCount = others.filter(
          (o) => o.cell.kind === 'bool' && o.cell.value === true,
        ).length
        const falseCount = others.length - trueCount
        const majority = majorityBoolean(trueCount, falseCount)
        if (majority === null) {
          acc.unilateral++ // tie among others — no clean consensus
          continue
        }
        if (e.cell.value === majority) acc.aligned++
        else acc.diverged++
      } else {
        // Numeric median of the others.
        const otherNums = others
          .map((o) => (o.cell.kind === 'num' ? o.cell.value : null))
          .filter((x): x is number => x !== null)
        if (otherNums.length === 0) {
          acc.unilateral++
          continue
        }
        const m = median(otherNums)
        if (withinTolerance(e.cell.value, m, PEER_TOLERANCE)) acc.aligned++
        else acc.diverged++
      }
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
  const [adminScores, trajPeerScores, pairPeerScores] = await Promise.all([
    getWorkspaceApprovalTrust(workspaceId),
    getWorkspacePeerTrust(workspaceId),
    getWorkspacePairPeerTrust(workspaceId),
  ])
  const byUser = new Map<string, UserTrust>()
  // Merge peer sources additively: a user with peer signal from BOTH
  // trajectory step_annotations AND pair-mode payloads gets the union
  // of their alignment events. This is conservative — more samples =
  // tighter posterior, all on the same prior.
  const peerMerged = new Map<
    string,
    {
      aligned: number
      diverged: number
      unilateral: number
      displayName: string | null
    }
  >()
  for (const list of [trajPeerScores, pairPeerScores]) {
    for (const p of list) {
      const prev = peerMerged.get(p.userId)
      if (prev) {
        prev.aligned += p.aligned
        prev.diverged += p.diverged
        prev.unilateral += p.unilateral
      } else {
        peerMerged.set(p.userId, {
          aligned: p.aligned,
          diverged: p.diverged,
          unilateral: p.unilateral,
          displayName: p.displayName,
        })
      }
    }
  }
  for (const [userId, m] of peerMerged) {
    byUser.set(userId, {
      source: 'peer',
      userId,
      displayName: m.displayName,
      aligned: m.aligned,
      diverged: m.diverged,
      unilateral: m.unilateral,
      score: smoothed(m.aligned, m.diverged),
    })
  }
  // Admin overrides (authoritative).
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
