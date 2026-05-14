import 'server-only'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  goldStandards,
  stepAnnotations,
  tasks,
  topics,
  trajectories,
  users,
} from '@/lib/db/schema'
import type { Mark } from '@/lib/templates/rubric'
import {
  calibrateMarkSet,
  smoothCalibration,
} from '@/lib/quality/calibrate'

/**
 * Gold standards — reference answers an admin has frozen for a trajectory.
 *
 * Storage shape (in the existing generic `gold_standards` table):
 *
 *   item_data = {
 *     kind: 'trajectory',
 *     workspaceId, trajectoryId,
 *     sourceAnnotationId, promotedByUserId, promotedAt,
 *   }
 *   correct_answer = {
 *     trajectoryMarks: Record<rubricId, Mark>,
 *     stepMarks: Record<stepId, Record<rubricId, Mark>>,
 *   }
 *
 * We snapshot the admin's annotation at promotion time — the gold doesn't
 * track the live annotation. That decouples ground-truth from ongoing
 * edits and gives admins a stable reference point.
 */

export type GoldItemData = {
  kind: 'trajectory'
  workspaceId: string
  trajectoryId: string
  sourceAnnotationId: string
  promotedByUserId: string
  promotedAt: string // ISO
}

export type GoldCorrectAnswer = {
  trajectoryMarks: Record<string, Mark>
  stepMarks: Record<string, Record<string, Mark>>
}

export interface GoldStandardRow {
  id: string
  taskId: string
  trajectoryId: string
  workspaceId: string
  promotedByUserId: string
  promotedByDisplayName: string | null
  promotedAt: Date
  explanation: string | null
  /** Total rubric slots in the gold (trajectory + step), for "X items" UI */
  rubricCount: number
}

/**
 * List every gold-standard trajectory in a workspace.
 *
 * Filters to gold rows whose itemData.kind === 'trajectory' AND
 * itemData.workspaceId === target — defensive in case future gold kinds
 * land in the same table.
 */
export async function listWorkspaceGoldStandards(
  workspaceId: string,
): Promise<GoldStandardRow[]> {
  const db = getDb()
  // Fetch tasks in this workspace first so we can scope the gold query.
  const taskIds = (
    await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.workspaceId, workspaceId))
  ).map((r) => r.id)
  if (taskIds.length === 0) return []

  const rows = await db
    .select({
      id: goldStandards.id,
      taskId: goldStandards.taskId,
      itemData: goldStandards.itemData,
      correctAnswer: goldStandards.correctAnswer,
      explanation: goldStandards.explanation,
      createdAt: goldStandards.createdAt,
    })
    .from(goldStandards)
    .where(inArray(goldStandards.taskId, taskIds))
    .orderBy(desc(goldStandards.createdAt))

  // Backfill promoter display names.
  const promoterIds = new Set<string>()
  const parsed = rows
    .map((r) => {
      const item = r.itemData as GoldItemData | null
      if (!item || item.kind !== 'trajectory' || item.workspaceId !== workspaceId) {
        return null
      }
      promoterIds.add(item.promotedByUserId)
      return { row: r, item }
    })
    .filter((x): x is { row: typeof rows[number]; item: GoldItemData } => x !== null)

  const nameById = new Map<string, string | null>()
  if (promoterIds.size > 0) {
    const userRows = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, [...promoterIds]))
    for (const u of userRows) nameById.set(u.id, u.displayName)
  }

  return parsed.map(({ row, item }) => {
    const ans = (row.correctAnswer ?? {}) as Partial<GoldCorrectAnswer>
    const trajCount = Object.keys(ans.trajectoryMarks ?? {}).length
    const stepCount = Object.values(ans.stepMarks ?? {}).reduce(
      (acc, m) => acc + Object.keys(m).length,
      0,
    )
    return {
      id: row.id,
      taskId: row.taskId,
      trajectoryId: item.trajectoryId,
      workspaceId: item.workspaceId,
      promotedByUserId: item.promotedByUserId,
      promotedByDisplayName: nameById.get(item.promotedByUserId) ?? null,
      promotedAt: new Date(item.promotedAt),
      explanation: row.explanation,
      rubricCount: trajCount + stepCount,
    }
  })
}

/**
 * Cheap id-only set for "is this trajectory a gold?" badges on list views.
 *
 * Skips the heavy payload+promoter joins that `listWorkspaceGoldStandards`
 * does — list pages just need the set membership for badge rendering.
 */
export async function listGoldTrajectoryIds(
  workspaceId: string,
): Promise<Set<string>> {
  const db = getDb()
  const taskIds = (
    await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.workspaceId, workspaceId))
  ).map((r) => r.id)
  if (taskIds.length === 0) return new Set()

  const rows = await db
    .select({ itemData: goldStandards.itemData })
    .from(goldStandards)
    .where(inArray(goldStandards.taskId, taskIds))

  const out = new Set<string>()
  for (const r of rows) {
    const item = r.itemData as GoldItemData | null
    if (!item || item.kind !== 'trajectory') continue
    if (item.workspaceId !== workspaceId) continue
    out.add(item.trajectoryId)
  }
  return out
}

/**
 * Return the gold (if any) for a specific trajectory.
 *
 * Returns the raw correctAnswer for use by the calibration scorer and the
 * "edit gold" / "show gold answer" admin UIs.
 */
export async function getGoldForTrajectory(opts: {
  workspaceId: string
  trajectoryId: string
}): Promise<
  | {
      id: string
      promotedByUserId: string
      promotedAt: Date
      explanation: string | null
      correctAnswer: GoldCorrectAnswer
    }
  | null
> {
  const db = getDb()
  const rows = await db
    .select({
      id: goldStandards.id,
      itemData: goldStandards.itemData,
      correctAnswer: goldStandards.correctAnswer,
      explanation: goldStandards.explanation,
    })
    .from(goldStandards)
  for (const r of rows) {
    const item = r.itemData as GoldItemData | null
    if (!item || item.kind !== 'trajectory') continue
    if (item.workspaceId !== opts.workspaceId) continue
    if (item.trajectoryId !== opts.trajectoryId) continue
    return {
      id: r.id,
      promotedByUserId: item.promotedByUserId,
      promotedAt: new Date(item.promotedAt),
      explanation: r.explanation,
      correctAnswer: (r.correctAnswer ?? {
        trajectoryMarks: {},
        stepMarks: {},
      }) as GoldCorrectAnswer,
    }
  }
  return null
}

// ─── Per-user calibration ────────────────────────────────────────────────

/**
 * Per-user calibration: how often did this user's marks match the gold
 * across every gold trajectory in the workspace they've annotated?
 *
 * Returns null when the workspace has no gold standards. Returns a row
 * even when the user has annotated zero golds (their score lands at 0.5
 * smoothed baseline) — distinguishing "no data" from "no work".
 */
export interface UserCalibration {
  userId: string
  displayName: string | null
  matched: number
  diverged: number
  missed: number
  goldsCovered: number // distinct gold trajectories the user has annotated
  /** Bayesian-smoothed match rate (matched vs diverged; missed/skipped ignored). */
  score: number
}

/**
 * Compute per-user calibration across all golds in the workspace.
 *
 * Cost: one scan of all gold rows + their annotators' marks. For MVP scale
 * (tens of golds × tens of raters) this is tens of rows. Don't paginate.
 */
export async function getWorkspaceCalibration(
  workspaceId: string,
): Promise<UserCalibration[]> {
  const db = getDb()
  const golds = await listWorkspaceGoldStandards(workspaceId)
  if (golds.length === 0) return []

  // Pull each gold's full correctAnswer.
  const goldsFull = await db
    .select({
      id: goldStandards.id,
      itemData: goldStandards.itemData,
      correctAnswer: goldStandards.correctAnswer,
    })
    .from(goldStandards)
    .where(
      inArray(
        goldStandards.id,
        golds.map((g) => g.id),
      ),
    )
  const goldByTrajId = new Map<string, GoldCorrectAnswer>()
  for (const g of goldsFull) {
    const item = g.itemData as GoldItemData | null
    if (!item) continue
    goldByTrajId.set(
      item.trajectoryId,
      (g.correctAnswer ?? {
        trajectoryMarks: {},
        stepMarks: {},
      }) as GoldCorrectAnswer,
    )
  }

  // Pull every annotation row whose topic.taskId is in this workspace AND
  // whose trajectory is one of the gold trajectories. We need:
  //   - annotation.userId, payload (for trajectory-level marks)
  //   - step_annotations for the same annotation (for step marks)
  // Each annotation also needs to be linked to its trajectory — through
  // step_annotations.trajectoryStepId → trajectory_steps → trajectories.
  // Cheaper path: use the per-step join we already use in trust-consensus.
  const trajIds = [...goldByTrajId.keys()]
  if (trajIds.length === 0) return []

  // 1. All step_annotations rows on gold trajectories, with rater + traj id.
  // We pull via topics→annotations to get userId, plus join through steps
  // back to the trajectory.
  const stepRows = await db
    .select({
      annotationId: stepAnnotations.annotationId,
      userId: annotations.userId,
      displayName: users.displayName,
      trajectoryStepId: stepAnnotations.trajectoryStepId,
      rubricKind: stepAnnotations.kind,
      payload: stepAnnotations.payload,
      // Resolve trajectoryId via topic.taskId → workspace boundary check.
      trajectoryId: sql<string>`(
        select t.trajectory_id from trajectory_steps t where t.id = ${stepAnnotations.trajectoryStepId}
      )`.as('trajectoryId'),
    })
    .from(stepAnnotations)
    .innerJoin(annotations, eq(annotations.id, stepAnnotations.annotationId))
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .innerJoin(users, eq(users.id, annotations.userId))
    .where(eq(tasks.workspaceId, workspaceId))

  // 2. Trajectory-level marks live on annotations.payload — fetch only the
  // annotations on gold trajectories.
  const annPayloads = await db
    .select({
      id: annotations.id,
      userId: annotations.userId,
      displayName: users.displayName,
      payload: annotations.payload,
      trajectoryId: sql<string>`(
        select trajectory_id from (
          select distinct ts.trajectory_id, sa.annotation_id
          from step_annotations sa
          join trajectory_steps ts on ts.id = sa.trajectory_step_id
        ) x where x.annotation_id = ${annotations.id} limit 1
      )`.as('trajectoryId'),
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .innerJoin(users, eq(users.id, annotations.userId))
    .where(eq(tasks.workspaceId, workspaceId))

  // Aggregate per user.
  type Tally = {
    displayName: string | null
    matched: number
    diverged: number
    missed: number
    goldsCovered: Set<string>
  }
  const byUser = new Map<string, Tally>()
  const init = (userId: string, displayName: string | null): Tally => {
    const e = byUser.get(userId)
    if (e) return e
    const t: Tally = {
      displayName,
      matched: 0,
      diverged: 0,
      missed: 0,
      goldsCovered: new Set(),
    }
    byUser.set(userId, t)
    return t
  }

  // 1. Step-level calibration
  // Group user step marks by (userId, trajectoryId, stepId), then compare per rubric.
  type UserStepMarks = Map<
    string, // stepId
    Map<string, Mark> // rubricId → Mark
  >
  const userStepBuckets = new Map<
    string, // userId|trajectoryId
    UserStepMarks
  >()
  for (const r of stepRows) {
    if (!r.trajectoryId) continue
    if (!goldByTrajId.has(r.trajectoryId)) continue
    const mark = (r.payload ?? null) as Mark | null
    if (!mark || !('scale' in mark)) continue
    const key = `${r.userId}|${r.trajectoryId}`
    const stepMap = userStepBuckets.get(key) ?? new Map()
    const rubricMap = stepMap.get(r.trajectoryStepId) ?? new Map<string, Mark>()
    rubricMap.set(r.rubricKind, mark)
    stepMap.set(r.trajectoryStepId, rubricMap)
    userStepBuckets.set(key, stepMap)
    init(r.userId, r.displayName).goldsCovered.add(r.trajectoryId)
  }
  for (const [key, stepMap] of userStepBuckets) {
    const [userId, trajectoryId] = key.split('|')
    const gold = goldByTrajId.get(trajectoryId)
    if (!gold) continue
    const goldStepMarks = gold.stepMarks ?? {}
    for (const [stepId, goldRubrics] of Object.entries(goldStepMarks)) {
      const userRubrics = stepMap.get(stepId) ?? new Map<string, Mark>()
      const userRubricsObj: Record<string, Mark> = {}
      for (const [k, v] of userRubrics) userRubricsObj[k] = v
      const res = calibrateMarkSet({
        goldMarks: goldRubrics,
        userMarks: userRubricsObj,
      })
      const t = init(userId, null)
      t.matched += res.matched
      t.diverged += res.diverged
      t.missed += res.missed
    }
  }

  // 2. Trajectory-level calibration
  for (const a of annPayloads) {
    if (!a.trajectoryId) continue
    const gold = goldByTrajId.get(a.trajectoryId)
    if (!gold) continue
    const userTrajMarks: Record<string, Mark> = {}
    const payload = (a.payload ?? {}) as Record<string, unknown>
    for (const [k, v] of Object.entries(payload)) {
      if (v && typeof v === 'object' && 'scale' in (v as object)) {
        userTrajMarks[k] = v as Mark
      }
    }
    const res = calibrateMarkSet({
      goldMarks: gold.trajectoryMarks ?? {},
      userMarks: userTrajMarks,
    })
    const t = init(a.userId, a.displayName)
    t.matched += res.matched
    t.diverged += res.diverged
    t.missed += res.missed
    t.goldsCovered.add(a.trajectoryId)
  }

  // Don't include the gold promoters themselves — comparing them to their
  // own answer would always be a 100% match (skewing the leaderboard).
  const promoters = new Set(golds.map((g) => g.promotedByUserId))

  const out: UserCalibration[] = []
  for (const [userId, t] of byUser) {
    if (promoters.has(userId)) continue
    out.push({
      userId,
      displayName: t.displayName,
      matched: t.matched,
      diverged: t.diverged,
      missed: t.missed,
      goldsCovered: t.goldsCovered.size,
      score: smoothCalibration(t.matched, t.diverged),
    })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}
