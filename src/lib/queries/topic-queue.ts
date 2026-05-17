import 'server-only'
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
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
 * Topic-queue helper for the pair-rubric and arena-gsb modes.
 *
 * Pairs (NOT trajectories) live in `topics` and are claimed by setting
 * `topics.assignedTo`. The queue surface here mirrors the trajectory
 * queue but with simpler priority — pair/arena don't have step-level
 * disputes, so the only sort signal is "in-progress" vs "fresh".
 *
 * Caller is responsible for the workspace-membership check; this query
 * just filters to workspaces the user actually belongs to.
 */

export type TopicQueueItem = {
  topicId: string
  taskId: string
  taskName: string
  workspaceId: string
  workspaceName: string
  templateMode: 'pair-rubric' | 'arena-gsb'
  promptPreview: string
  topicStatus: string
  /**
   * 'mine' — I have an in-progress draft (assignedTo === me, submittedAt null)
   * 'fresh' — unassigned, anyone can claim
   * 'submitted' — I already submitted (kept in list for visibility but
   *               styled as done so the user knows they're awaiting QC)
   */
  state: 'mine' | 'fresh' | 'submitted'
  createdAt: Date
  /**
   * AI-estimated 1-5 difficulty score (null = not estimated). Shown as
   * a chip on the queue card so the annotator knows what they're
   * picking up before clicking.
   */
  difficulty: number | null
  /** One-line AI rationale, surfaced in a tooltip on the chip. */
  difficultyReason: string | null
  /** Active-Learning IG score in [0, 1] (Phase-12). Drives the 'fresh'
   *  bucket ordering — high-IG topics surface first. */
  igScore: number | null
}

export interface ListMyTopicQueueOpts {
  userId: string
  /** Scope to one workspace. When omitted, spans every workspace I'm in. */
  workspaceId?: string
  limit?: number
}

export async function listMyTopicQueueForUser(
  opts: ListMyTopicQueueOpts,
): Promise<TopicQueueItem[]> {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 50, 200)

  // 1. Workspaces I can do work in (annotator / qc / admin — not viewer).
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
      (r) =>
        r.role === 'admin' || r.role === 'qc' || r.role === 'annotator',
    )
    .map((r) => r.workspaceId)
    .filter((id) => !opts.workspaceId || id === opts.workspaceId)
  if (workspaceIds.length === 0) return []
  const workspaceNameById = new Map(
    memberRows.map((r) => [r.workspaceId, r.workspaceName]),
  )

  // 2. Topics in those workspaces whose task uses one of the pair modes,
  //    AND the task is published (status='open' so the topic is claimable).
  const rows = await db
    .select({
      topicId: topics.id,
      taskId: topics.taskId,
      taskName: tasks.name,
      workspaceId: tasks.workspaceId,
      templateMode: tasks.templateMode,
      itemData: topics.itemData,
      topicStatus: topics.status,
      assignedTo: topics.assignedTo,
      topicCreatedAt: topics.createdAt,
      difficulty: topics.difficulty,
      difficultyReason: topics.difficultyReason,
      myAnnotationSubmittedAt: annotations.submittedAt,
    })
    .from(topics)
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .leftJoin(
      annotations,
      and(
        eq(annotations.topicId, topics.id),
        eq(annotations.userId, opts.userId),
      ),
    )
    .where(
      and(
        inArray(tasks.workspaceId, workspaceIds),
        or(
          eq(tasks.templateMode, 'pair-rubric'),
          eq(tasks.templateMode, 'arena-gsb'),
        ),
        eq(tasks.status, 'open'),
      ),
    )
    .limit(limit * 4) // over-fetch a bit; we filter below

  // 3. Bucket each topic. We surface:
  //    - 'mine': I'm the assignedTo and I haven't submitted
  //    - 'fresh': no assignee yet
  //    - 'submitted': I already submitted (kept low-priority for visibility)
  //
  // We drop topics claimed by someone else (someone else's work, my hands
  // are tied) UNLESS I've already submitted on it — that gives me a way
  // to find my history.
  const out: TopicQueueItem[] = []
  for (const r of rows) {
    const mode = r.templateMode as 'pair-rubric' | 'arena-gsb' | string
    if (mode !== 'pair-rubric' && mode !== 'arena-gsb') continue
    const itemData = (r.itemData ?? {}) as { prompt?: unknown }
    const promptPreview =
      typeof itemData.prompt === 'string'
        ? itemData.prompt.slice(0, 140)
        : '(no prompt)'

    let state: TopicQueueItem['state']
    if (r.myAnnotationSubmittedAt) {
      state = 'submitted'
    } else if (r.assignedTo === opts.userId) {
      state = 'mine'
    } else if (r.assignedTo === null) {
      state = 'fresh'
    } else {
      // Claimed by someone else, not me — skip.
      continue
    }
    out.push({
      topicId: r.topicId,
      taskId: r.taskId,
      taskName: r.taskName,
      workspaceId: r.workspaceId,
      workspaceName: workspaceNameById.get(r.workspaceId) ?? '',
      templateMode: mode,
      promptPreview,
      topicStatus: r.topicStatus,
      state,
      createdAt: r.topicCreatedAt,
      difficulty: r.difficulty,
      difficultyReason: r.difficultyReason,
      igScore: null, // filled in below per-workspace
    })
  }

  // 4. Active-learning IG scores. DS runs are workspace-scoped, so we
  //    fan out one query per workspace present in the queue. For the
  //    typical user in 1-3 workspaces this is fine; if a user joins
  //    20+ workspaces this becomes 20 queries and we'd batch by ws.
  const taskIdsByWs = new Map<string, Set<string>>()
  for (const it of out) {
    const s = taskIdsByWs.get(it.workspaceId) ?? new Set<string>()
    s.add(it.taskId)
    taskIdsByWs.set(it.workspaceId, s)
  }
  const igByTopic = new Map<string, number>()
  await Promise.all(
    Array.from(taskIdsByWs.entries()).map(async ([wsId, taskSet]) => {
      const scores = await getActiveLearningScores({
        workspaceId: wsId,
        taskIds: Array.from(taskSet),
      })
      for (const [tid, sc] of scores) igByTopic.set(tid, sc)
    }),
  )
  for (const it of out) {
    it.igScore = igByTopic.get(it.topicId) ?? null
  }

  // 5. Priority order: mine > fresh > submitted.
  //    Within 'fresh' we now sort by IG descending; older-first is the
  //    tiebreaker. Other buckets keep the old FIFO.
  const rank: Record<TopicQueueItem['state'], number> = {
    mine: 0,
    fresh: 1,
    submitted: 2,
  }
  out.sort((a, b) => {
    const r = rank[a.state] - rank[b.state]
    if (r !== 0) return r
    if (a.state === 'fresh' && b.state === 'fresh') {
      const ai = a.igScore ?? 0
      const bi = b.igScore ?? 0
      if (ai !== bi) return bi - ai
    }
    return a.createdAt.getTime() - b.createdAt.getTime()
  })

  return out.slice(0, limit)
}
