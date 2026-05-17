import 'server-only'
import { and, count, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  tasks,
  topics,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema'
import { getActiveLearningScores } from '@/lib/queries/active-learning'

/**
 * Annotator-facing "my tasks" view — the two-tier flow described by
 * production data-labeling platforms (Xpert, Scale, Surge): pick a
 * CAMPAIGN first, then drill into individual topics.
 *
 * This replaces the flat /my/queue feed as the primary entry. Each
 * card answers the four questions a labeler asks at a glance:
 *   - what's this task about (name + template mode)
 *   - how much does it pay (reward.baseAmountMinor + currency)
 *   - how many topics can I still pick up (claimable count)
 *   - what's my progress (in-flight + submitted by me)
 *
 * Scope: tasks in workspaces I'm a member of (not viewer) where the
 * task status is 'open'. Trajectory-mode tasks are excluded — their
 * work loop has a separate page (/workspaces/[id]/trajectories).
 */

export interface MyTaskCard {
  taskId: string
  taskName: string
  taskDescription: string | null
  workspaceId: string
  workspaceName: string
  templateMode: 'pair-rubric' | 'arena-gsb'
  /** ISO 4217 / token symbol from rewardConfig.currency. */
  currency: string | null
  /** Per-topic pay in MAJOR units (元 / USD) for human display.
   *  Null when economy type doesn't have a base amount. */
  rewardPerTopic: number | null
  /** Open topics in this task I could still pick up (unassigned + my drafts). */
  claimableCount: number
  /** Topics I've already submitted on (kept for context — "I did 4 of 50"). */
  mySubmittedCount: number
  /** Total topic count (denominator). */
  totalTopics: number
  /** Deadline, when set on the task row. UI shows "in 5 days" or "今天". */
  deadline: Date | null
  /** Task createdAt — used to sort newest first. */
  createdAt: Date
}

export async function listMyTasks(opts: {
  userId: string
  /** Cap on cards — 50 is plenty for any one labeler. */
  limit?: number
}): Promise<MyTaskCard[]> {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 50, 200)

  // 1. Workspaces I can do work in.
  const memberRows = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      workspaceName: workspaces.name,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, opts.userId))

  const workspaceIds = memberRows
    .filter(
      (r) => r.role === 'admin' || r.role === 'qc' || r.role === 'annotator',
    )
    .map((r) => r.workspaceId)
  if (workspaceIds.length === 0) return []
  const workspaceNameById = new Map(
    memberRows.map((r) => [r.workspaceId, r.workspaceName]),
  )

  // 2. Open tasks in those workspaces using a topic-payload mode.
  const taskRows = await db
    .select({
      id: tasks.id,
      name: tasks.name,
      description: tasks.description,
      workspaceId: tasks.workspaceId,
      templateMode: tasks.templateMode,
      rewardConfig: tasks.rewardConfig,
      status: tasks.status,
      deadline: tasks.deadline,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(
      and(
        inArray(tasks.workspaceId, workspaceIds),
        inArray(tasks.templateMode, ['pair-rubric', 'arena-gsb']),
        eq(tasks.status, 'open'),
      ),
    )

  if (taskRows.length === 0) return []
  const taskIds = taskRows.map((t) => t.id)

  // 3. Per-task counts — three SUM-CASE rolled into one query. Bins:
  //    - totalTopics: every row under the task
  //    - mySubmittedCount: topics where I have a submitted annotation
  //    - claimableCount: topics with assignedTo IS NULL (free to grab)
  //                      + topics assigned to ME with no submitted annotation
  //                        (my own drafts I should finish)
  //   Cross-rater claims of other people are EXCLUDED from claimable.
  const countsRaw = await db
    .select({
      taskId: topics.taskId,
      claimable: sql<number>`SUM(CASE
        WHEN ${topics.assignedTo} IS NULL THEN 1
        WHEN ${topics.assignedTo} = ${opts.userId}
             AND ${annotations.submittedAt} IS NULL THEN 1
        ELSE 0
      END)::int`,
      mySubmitted: sql<number>`SUM(CASE
        WHEN ${annotations.submittedAt} IS NOT NULL THEN 1
        ELSE 0
      END)::int`,
      total: count(),
    })
    .from(topics)
    .leftJoin(
      annotations,
      and(
        eq(annotations.topicId, topics.id),
        eq(annotations.userId, opts.userId),
      ),
    )
    .where(inArray(topics.taskId, taskIds))
    .groupBy(topics.taskId)

  // Silence unused-imports — these are used in the SQL builder above.
  void isNull
  void isNotNull

  const countsByTask = new Map(countsRaw.map((r) => [r.taskId, r]))

  // 4. Assemble cards.
  const out: MyTaskCard[] = taskRows.map((t) => {
    const c = countsByTask.get(t.id) ?? {
      claimable: 0,
      mySubmitted: 0,
      total: 0,
    }
    const economy =
      (t.rewardConfig ?? {}) as {
        baseAmountMinor?: number
        currency?: string
      }
    const rewardPerTopic =
      typeof economy.baseAmountMinor === 'number' &&
      economy.baseAmountMinor > 0
        ? economy.baseAmountMinor / 100
        : null
    return {
      taskId: t.id,
      taskName: t.name,
      taskDescription: t.description,
      workspaceId: t.workspaceId,
      workspaceName: workspaceNameById.get(t.workspaceId) ?? '',
      templateMode: t.templateMode as 'pair-rubric' | 'arena-gsb',
      currency: economy.currency ?? null,
      rewardPerTopic,
      claimableCount: Number(c.claimable ?? 0),
      mySubmittedCount: Number(c.mySubmitted ?? 0),
      totalTopics: Number(c.total ?? 0),
      deadline: t.deadline,
      createdAt: t.createdAt,
    }
  })

  // Sort: tasks with claimable topics first (those are the ones a
  // labeler can actually work on right now), then newest first.
  out.sort((a, b) => {
    if (a.claimableCount === 0 && b.claimableCount > 0) return 1
    if (b.claimableCount === 0 && a.claimableCount > 0) return -1
    return b.createdAt.getTime() - a.createdAt.getTime()
  })

  return out.slice(0, limit)
}

// ─── Drill-down: topics within one task, my-state-aware ────────────

export interface MyTaskTopicRow {
  topicId: string
  promptPreview: string
  /** 'mine'      — I claimed it, draft in flight
   *  'fresh'     — unclaimed, anyone can grab
   *  'submitted' — I already submitted
   *  'others'    — someone else claimed it (greyed out, not pickable) */
  state: 'mine' | 'fresh' | 'submitted' | 'others'
  /** AI-estimated 1-5 difficulty (Phase-8) — null when not estimated. */
  difficulty: number | null
  difficultyReason: string | null
  createdAt: Date
  /**
   * Active-Learning information-gain score in [0, 1] (Phase-12). Higher
   * = labeling this topic now reduces our uncertainty the most. Used to
   * order the 'fresh' bucket so annotators tackle the most valuable
   * topics first. Null when no DS run has happened yet AND there's no
   * coverage gap to drive the score.
   */
  igScore: number | null
}

export interface MyTaskDetail {
  task: {
    id: string
    name: string
    description: string | null
    guidelinesMarkdown: string | null
    workspaceId: string
    workspaceName: string
    templateMode: 'pair-rubric' | 'arena-gsb'
    currency: string | null
    rewardPerTopic: number | null
    deadline: Date | null
  }
  topics: MyTaskTopicRow[]
  /** Bucket counts for the filter chips. */
  counts: {
    fresh: number
    mine: number
    submitted: number
    others: number
  }
}

export async function getMyTaskDetail(opts: {
  userId: string
  taskId: string
}): Promise<MyTaskDetail | null> {
  const db = getDb()

  const [task] = await db
    .select({
      id: tasks.id,
      name: tasks.name,
      description: tasks.description,
      guidelinesMarkdown: tasks.guidelinesMarkdown,
      workspaceId: tasks.workspaceId,
      workspaceName: workspaces.name,
      templateMode: tasks.templateMode,
      rewardConfig: tasks.rewardConfig,
      deadline: tasks.deadline,
      status: tasks.status,
    })
    .from(tasks)
    .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .where(eq(tasks.id, opts.taskId))
    .limit(1)
  if (!task) return null

  // Auth — caller (page) is responsible for a proper auth gate before
  // calling this; we do a defensive secondary check by requiring an
  // active workspace membership.
  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, task.workspaceId),
        eq(workspaceMembers.userId, opts.userId),
      ),
    )
    .limit(1)
  if (!member) return null

  // Topics + my annotation join. We over-fetch up to 500 — typical
  // tasks are ≤ a few hundred topics and we want the full breakdown
  // for accurate counts. Past that we'd add pagination.
  const rows = await db
    .select({
      topicId: topics.id,
      itemData: topics.itemData,
      assignedTo: topics.assignedTo,
      createdAt: topics.createdAt,
      difficulty: topics.difficulty,
      difficultyReason: topics.difficultyReason,
      myAnnotationSubmittedAt: annotations.submittedAt,
    })
    .from(topics)
    .leftJoin(
      annotations,
      and(
        eq(annotations.topicId, topics.id),
        eq(annotations.userId, opts.userId),
      ),
    )
    .where(eq(topics.taskId, opts.taskId))
    .limit(500)

  // Active-learning IG scores for this task (scoped to one task — DS
  // is workspace-scoped but only this task's topics matter for sort).
  const igScores = await getActiveLearningScores({
    workspaceId: task.workspaceId,
    taskIds: [opts.taskId],
  })

  const counts = { fresh: 0, mine: 0, submitted: 0, others: 0 }
  const out: MyTaskTopicRow[] = []
  for (const r of rows) {
    const itemData = (r.itemData ?? {}) as { prompt?: unknown }
    const promptPreview =
      typeof itemData.prompt === 'string'
        ? itemData.prompt.slice(0, 200)
        : '(no prompt)'

    let state: MyTaskTopicRow['state']
    if (r.myAnnotationSubmittedAt) {
      state = 'submitted'
      counts.submitted += 1
    } else if (r.assignedTo === opts.userId) {
      state = 'mine'
      counts.mine += 1
    } else if (r.assignedTo === null) {
      state = 'fresh'
      counts.fresh += 1
    } else {
      state = 'others'
      counts.others += 1
    }
    out.push({
      topicId: r.topicId,
      promptPreview,
      state,
      difficulty: r.difficulty,
      difficultyReason: r.difficultyReason,
      createdAt: r.createdAt,
      igScore: igScores.get(r.topicId) ?? null,
    })
  }

  // Order: my drafts first (resume), then fresh (claimable),
  // then submitted, then others (greyed). Within the FRESH bucket we
  // sort by IG descending (high-value topics first) instead of FIFO —
  // active learning takes precedence. Within the other buckets the
  // old FIFO rule still holds (claims spread across topics).
  const rank: Record<MyTaskTopicRow['state'], number> = {
    mine: 0,
    fresh: 1,
    submitted: 2,
    others: 3,
  }
  out.sort((a, b) => {
    const r = rank[a.state] - rank[b.state]
    if (r !== 0) return r
    if (a.state === 'fresh' && b.state === 'fresh') {
      const ai = a.igScore ?? 0
      const bi = b.igScore ?? 0
      if (ai !== bi) return bi - ai // higher IG first
    }
    return a.createdAt.getTime() - b.createdAt.getTime()
  })

  const economy = (task.rewardConfig ?? {}) as {
    baseAmountMinor?: number
    currency?: string
  }
  const rewardPerTopic =
    typeof economy.baseAmountMinor === 'number' && economy.baseAmountMinor > 0
      ? economy.baseAmountMinor / 100
      : null

  return {
    task: {
      id: task.id,
      name: task.name,
      description: task.description,
      guidelinesMarkdown: task.guidelinesMarkdown,
      workspaceId: task.workspaceId,
      workspaceName: task.workspaceName,
      templateMode: task.templateMode as 'pair-rubric' | 'arena-gsb',
      currency: economy.currency ?? null,
      rewardPerTopic,
      deadline: task.deadline,
    },
    topics: out,
    counts,
  }
}
