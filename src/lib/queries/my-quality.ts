import 'server-only'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  tasks,
  topics,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema'
import { getAnnotatorDrilldown } from '@/lib/queries/rater-drilldown'

/**
 * Annotator-facing self-view ("/my/quality").
 *
 * Design intent: give raters enough feedback to IMPROVE, not enough
 * to GAME the score. We deliberately:
 *   - DO show approval rate trend (last 8 weeks)
 *   - DO show per-rubric/dimension weakness chips (so they know what
 *     to focus on)
 *   - DO show lifecycle status if non-active (with the reason)
 *   - DO show recent rejection feedback verbatim (so they can fix it)
 *   - DON'T show the raw composite trust score
 *   - DON'T show absolute rank vs peers (creates perverse "race to
 *     top" incentives)
 *
 * Cross-workspace: we surface one card per workspace, since trust is
 * workspace-scoped post-Phase-9. A rater in three workspaces gets
 * three independent self-views.
 */

export interface MyQualityWorkspace {
  workspaceId: string
  workspaceName: string
  /** Lifecycle state — surfaced as a banner when non-active. */
  trustStatus: 'active' | 'probation' | 'suspended'
  trustStatusReason: string | null
  trustStatusAt: Date | null
  /** Cold counts — total submitted/approved/rejected in this workspace. */
  submitted: number
  approved: number
  rejected: number
  pending: number
  /** 8-week trend: oldest → newest weekly buckets, each is a smoothed
   *  approval-rate in 0-1 (or null when fewer than 3 events that week). */
  trendWeekly: Array<{ weekStart: Date; rate: number | null; sampleCount: number }>
  /** Per-axis weakness — worst-aligned rubric items/dimensions/step kinds.
   *  Cap 5 entries so the UI stays scannable. */
  weakAxes: Array<{ axisId: string; aligned: number; diverged: number; rate: number }>
  /** Recent rejection feedback strings, most recent first, cap 5. */
  recentFeedback: Array<{
    type: 'rejected' | 'revised'
    feedback: string
    ts: Date
    annotationId: string
    topicId: string
    taskId: string
  }>
}

export interface MyQualitySnapshot {
  workspaces: MyQualityWorkspace[]
}

const PRIOR_ALPHA = 2.5
const PRIOR_BETA = 2.5

export async function getMyQuality(userId: string): Promise<MyQualitySnapshot> {
  const db = getDb()

  // 1. Workspaces I'm in (any role except viewer).
  const memberRows = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      workspaceName: workspaces.name,
      trustStatus: workspaceMembers.trustStatus,
      trustStatusReason: workspaceMembers.trustStatusReason,
      trustStatusAt: workspaceMembers.trustStatusAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
  if (memberRows.length === 0) return { workspaces: [] }

  // We don't filter by role here — raters with role=viewer simply
  // never have submissions, so their cards come back empty (skipped
  // by the empty-state path below).

  const out: MyQualityWorkspace[] = []
  for (const m of memberRows) {
    const ws = m.workspaceId

    // 2a. Cold counts.
    const [counts] = await db
      .select({
        submitted: sql<number>`SUM(CASE WHEN ${annotations.submittedAt} IS NOT NULL THEN 1 ELSE 0 END)::int`,
        approved: sql<number>`SUM(CASE WHEN ${topics.status} = 'approved' AND ${annotations.submittedAt} IS NOT NULL THEN 1 ELSE 0 END)::int`,
        rejected: sql<number>`SUM(CASE WHEN ${topics.status} = 'rejected' AND ${annotations.submittedAt} IS NOT NULL THEN 1 ELSE 0 END)::int`,
        pending: sql<number>`SUM(CASE WHEN ${topics.status} IN ('submitted','reviewing','awaiting_acceptance','revising') THEN 1 ELSE 0 END)::int`,
      })
      .from(annotations)
      .innerJoin(topics, eq(topics.id, annotations.topicId))
      .innerJoin(tasks, eq(tasks.id, topics.taskId))
      .where(
        and(
          eq(annotations.userId, userId),
          eq(tasks.workspaceId, ws),
        ),
      )

    // Skip empty workspaces (rater in workspace but never submitted).
    const submitted = counts?.submitted ?? 0
    if (submitted === 0) continue

    // 2b. 8-week trend — bucket approve/reject events on this user.
    const eightWeeksAgo = new Date(
      Date.now() - 8 * 7 * 24 * 3600 * 1000,
    )
    const verdictEvents = await db
      .select({ ts: events.ts, type: events.type })
      .from(events)
      .where(
        and(
          eq(events.workspaceId, ws),
          sql`${events.payload} ->> 'submitterUserId' = ${userId}`,
          sql`${events.type} IN ('annotation.approved', 'annotation.rejected', 'annotation.qc_passed', 'annotation.revised')`,
          gte(events.ts, eightWeeksAgo),
        ),
      )
      .orderBy(events.ts)

    const trendWeekly = bucketByWeek(verdictEvents, eightWeeksAgo)

    // 2c. Weak axes — reuse the existing drilldown computation.
    let weakAxes: MyQualityWorkspace['weakAxes'] = []
    try {
      const drill = await getAnnotatorDrilldown({ userId, workspaceId: ws })
      if (drill) {
        weakAxes = drill.axes
          .filter((a) => a.aligned + a.diverged >= 2) // need some signal
          .slice(0, 5)
          .map((a) => ({
            axisId: a.axisLabel,
            aligned: a.aligned,
            diverged: a.diverged,
            rate: a.score,
          }))
      }
    } catch {
      // Drilldown fails for very small workspaces; safely skip.
    }

    // 2d. Recent rejection / revision feedback — last 5, most-recent first.
    const feedbackRows = await db
      .select({
        type: events.type,
        ts: events.ts,
        payload: events.payload,
      })
      .from(events)
      .where(
        and(
          eq(events.workspaceId, ws),
          sql`${events.payload} ->> 'submitterUserId' = ${userId}`,
          sql`${events.type} IN ('annotation.rejected', 'annotation.revised')`,
          sql`${events.payload} ->> 'feedback' IS NOT NULL`,
        ),
      )
      .orderBy(desc(events.ts))
      .limit(5)
    const recentFeedback = feedbackRows
      .map((r) => {
        const p = (r.payload ?? {}) as Record<string, unknown>
        const fb =
          typeof p.feedback === 'string' ? p.feedback.trim() : ''
        if (!fb) return null
        return {
          type:
            r.type === 'annotation.rejected'
              ? ('rejected' as const)
              : ('revised' as const),
          feedback: fb,
          ts: r.ts,
          annotationId:
            typeof p.annotationId === 'string' ? p.annotationId : '',
          topicId: typeof p.topicId === 'string' ? p.topicId : '',
          taskId: typeof p.taskId === 'string' ? p.taskId : '',
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    out.push({
      workspaceId: ws,
      workspaceName: m.workspaceName,
      trustStatus:
        m.trustStatus === 'probation' || m.trustStatus === 'suspended'
          ? m.trustStatus
          : 'active',
      trustStatusReason: m.trustStatusReason,
      trustStatusAt: m.trustStatusAt,
      submitted,
      approved: counts?.approved ?? 0,
      rejected: counts?.rejected ?? 0,
      pending: counts?.pending ?? 0,
      trendWeekly,
      weakAxes,
      recentFeedback,
    })
  }

  // Sort: suspended/probation first (most urgent attention), then by
  // submitted count desc (where the rater is most engaged).
  out.sort((a, b) => {
    const rank = (s: typeof a.trustStatus) =>
      s === 'suspended' ? 0 : s === 'probation' ? 1 : 2
    const r = rank(a.trustStatus) - rank(b.trustStatus)
    if (r !== 0) return r
    return b.submitted - a.submitted
  })
  return { workspaces: out }
}

function bucketByWeek(
  rows: Array<{ ts: Date; type: string }>,
  since: Date,
): MyQualityWorkspace['trendWeekly'] {
  // 8 buckets, each one week wide, starting at `since`.
  const buckets: Array<{
    weekStart: Date
    approved: number
    rejected: number
  }> = []
  for (let i = 0; i < 8; i++) {
    const start = new Date(since.getTime() + i * 7 * 24 * 3600 * 1000)
    buckets.push({ weekStart: start, approved: 0, rejected: 0 })
  }
  const weekMs = 7 * 24 * 3600 * 1000
  for (const r of rows) {
    const idx = Math.floor((r.ts.getTime() - since.getTime()) / weekMs)
    if (idx < 0 || idx >= 8) continue
    const slot = buckets[idx]
    if (
      r.type === 'annotation.approved' ||
      r.type === 'annotation.qc_passed'
    ) {
      slot.approved += 1
    } else if (
      r.type === 'annotation.rejected' ||
      r.type === 'annotation.revised'
    ) {
      slot.rejected += 1
    }
  }
  return buckets.map((b) => {
    const n = b.approved + b.rejected
    if (n < 3) {
      // Insufficient signal — show a gap rather than a misleading 100%
      // or 0% rate from one or two events.
      return { weekStart: b.weekStart, rate: null, sampleCount: n }
    }
    const rate =
      (b.approved + PRIOR_ALPHA) / (n + PRIOR_ALPHA + PRIOR_BETA)
    return { weekStart: b.weekStart, rate, sampleCount: n }
  })
}
