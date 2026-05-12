import 'server-only'
import { and, eq, gte, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  guidelines,
  stepAnnotations,
  tasks,
  trajectories,
  trajectorySteps,
} from '@/lib/db/schema'

/**
 * Time-series rollups — the data layer for the "Watch your model learn"
 * charts on the workspace dashboard / disputes page.
 *
 * Three series we expose:
 *   1. dailyCaptureThroughput  — trajectories captured per day
 *   2. dailyAnnotationActivity — step_annotations created per day
 *   3. dailyAgreementRate      — % of multi-rater steps that agreed,
 *                                bucketed by day the LAST mark landed
 *   4. agreementByGuideline    — agreement rate per guideline version
 *
 * Per LabelHub project memory the hero narrative is "agreement rate ↑ as
 * guidelines mature." (4) is the chart that tells that story directly.
 *
 * All queries are workspace-scoped and ignore soft-deleted trajectories.
 * Default window: 30 days. Callers can override.
 */

const DAY_MS = 24 * 3600 * 1000

export interface DailyPoint {
  /** ISO date string YYYY-MM-DD (UTC). */
  date: string
  value: number
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS)
}

/**
 * Helper: fill in zero-points for missing days so the chart renders smoothly.
 */
function fillDays(rows: DailyPoint[], days: number): DailyPoint[] {
  const map = new Map(rows.map((r) => [r.date, r.value]))
  const out: DailyPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS)
    const iso = d.toISOString().slice(0, 10)
    out.push({ date: iso, value: map.get(iso) ?? 0 })
  }
  return out
}

/** Trajectories captured per day, last N days. */
export async function dailyCaptureThroughput(
  workspaceId: string,
  days = 30,
): Promise<DailyPoint[]> {
  const db = getDb()
  const since = daysAgo(days)
  const rows = (await db.execute(
    sql`
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
             COUNT(*)::int AS value
      FROM trajectories
      WHERE workspace_id = ${workspaceId}
        AND deleted_at IS NULL
        AND created_at >= ${since.toISOString()}
      GROUP BY 1
      ORDER BY 1
    `,
  )) as unknown as Array<{ date: string; value: number }>
  // postgres-js returns the array directly; some envs wrap as {rows}.
  const arr = Array.isArray(rows)
    ? rows
    : ((rows as unknown as { rows: Array<{ date: string; value: number }> })
        .rows ?? [])
  return fillDays(
    arr.map((r) => ({ date: r.date, value: Number(r.value) })),
    days,
  )
}

/** Step annotations created per day, last N days. */
export async function dailyAnnotationActivity(
  workspaceId: string,
  days = 30,
): Promise<DailyPoint[]> {
  const db = getDb()
  const since = daysAgo(days)
  const rows = (await db.execute(
    sql`
      SELECT to_char(sa.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
             COUNT(*)::int AS value
      FROM step_annotations sa
      INNER JOIN trajectory_steps ts ON ts.id = sa.trajectory_step_id
      INNER JOIN trajectories tr ON tr.id = ts.trajectory_id
      WHERE tr.workspace_id = ${workspaceId}
        AND tr.deleted_at IS NULL
        AND sa.created_at >= ${since.toISOString()}
      GROUP BY 1
      ORDER BY 1
    `,
  )) as unknown as Array<{ date: string; value: number }>
  const arr = Array.isArray(rows)
    ? rows
    : ((rows as unknown as { rows: Array<{ date: string; value: number }> })
        .rows ?? [])
  return fillDays(
    arr.map((r) => ({ date: r.date, value: Number(r.value) })),
    days,
  )
}

/**
 * Daily agreement rate.
 *
 * Bucketed by the day a multi-rater step was LAST rated (i.e., when it
 * became "resolved" with at least 2 raters). Returns null for days that
 * had no multi-rater step.
 */
export async function dailyAgreementRate(
  workspaceId: string,
  days = 30,
): Promise<Array<{ date: string; rate: number | null; n: number }>> {
  const db = getDb()
  const since = daysAgo(days)
  // Pull every (step × rating × created_at) so we can bucket in JS.
  const rows = await db
    .select({
      stepId: stepAnnotations.trajectoryStepId,
      rating: stepAnnotations.rating,
      kind: stepAnnotations.kind,
      createdAt: stepAnnotations.createdAt,
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
        eq(stepAnnotations.kind, 'step_quality'),
        gte(stepAnnotations.createdAt, since),
      ),
    )

  // For each step: find last-mark date + ratings list.
  type StepInfo = { lastDate: string; ratings: number[] }
  const byStep = new Map<string, StepInfo>()
  for (const r of rows) {
    if (r.rating == null) continue
    const date = r.createdAt.toISOString().slice(0, 10)
    const info = byStep.get(r.stepId) ?? { lastDate: date, ratings: [] }
    info.ratings.push(r.rating)
    if (date > info.lastDate) info.lastDate = date
    byStep.set(r.stepId, info)
  }

  // Bucket by lastDate.
  type DayBucket = { agreed: number; total: number }
  const byDay = new Map<string, DayBucket>()
  for (const info of byStep.values()) {
    if (info.ratings.length < 2) continue
    const spread = Math.max(...info.ratings) - Math.min(...info.ratings)
    const b = byDay.get(info.lastDate) ?? { agreed: 0, total: 0 }
    b.total++
    if (spread <= 1) b.agreed++
    byDay.set(info.lastDate, b)
  }

  // Emit one row per day in window (null when no data).
  const out: Array<{ date: string; rate: number | null; n: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    const iso = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10)
    const b = byDay.get(iso)
    out.push({
      date: iso,
      rate: b ? b.agreed / b.total : null,
      n: b?.total ?? 0,
    })
  }
  return out
}

/**
 * Agreement rate per guideline version — the "self-evolving" hero metric.
 *
 * For each guideline version of the workspace's Inbox task, returns the
 * agreement rate of step annotations CREATED WHILE THAT VERSION WAS LATEST.
 * Demonstrates: as the guideline matures via accepted patches, agreement
 * climbs.
 *
 * Implementation:
 *   - Sort guidelines by created_at
 *   - For each consecutive pair: the window is [g_i.created_at, g_{i+1}.created_at)
 *   - Take step_annotations in that window for steps with ≥2 raters
 *   - Compute agreement rate
 */
export async function agreementByGuidelineVersion(
  workspaceId: string,
): Promise<
  Array<{
    version: number
    createdAt: string
    annotatedSteps: number
    multiRaterSteps: number
    agreementRate: number | null
  }>
> {
  const db = getDb()
  // 1. Find the Inbox task for this workspace.
  const [inboxTask] = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.name, 'Inbox — Captured Trajectories'),
      ),
    )
    .limit(1)
  if (!inboxTask) return []

  // 2. All guideline versions for that task, sorted oldest → newest.
  const versions = await db
    .select()
    .from(guidelines)
    .where(eq(guidelines.taskId, inboxTask.id))
    .orderBy(guidelines.version)
  if (versions.length === 0) return []

  // 3. All step_annotations in this workspace.
  const rows = await db
    .select({
      stepId: stepAnnotations.trajectoryStepId,
      rating: stepAnnotations.rating,
      kind: stepAnnotations.kind,
      createdAt: stepAnnotations.createdAt,
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
        eq(stepAnnotations.kind, 'step_quality'),
      ),
    )

  // 4. For each version v_i, marks in window [v_i.createdAt, v_{i+1}.createdAt)
  // are attributed to v_i. The newest version's window is open-ended.
  return versions.map((v, i) => {
    const start = v.createdAt
    const end = versions[i + 1]?.createdAt ?? new Date(Date.now() + DAY_MS)
    const inWindow = rows.filter(
      (r) =>
        r.rating != null &&
        r.createdAt >= start &&
        r.createdAt < end,
    )
    const byStep = new Map<string, number[]>()
    for (const r of inWindow) {
      if (r.rating == null) continue
      const arr = byStep.get(r.stepId) ?? []
      arr.push(r.rating)
      byStep.set(r.stepId, arr)
    }
    let multi = 0
    let agreed = 0
    for (const arr of byStep.values()) {
      if (arr.length < 2) continue
      multi++
      if (Math.max(...arr) - Math.min(...arr) <= 1) agreed++
    }
    return {
      version: v.version,
      createdAt: v.createdAt.toISOString(),
      annotatedSteps: byStep.size,
      multiRaterSteps: multi,
      agreementRate: multi > 0 ? agreed / multi : null,
    }
  })
}
