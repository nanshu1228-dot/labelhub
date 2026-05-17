import 'server-only'
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  dsConsensusRuns,
  dsInferredLabels,
  tasks,
  topics,
} from '@/lib/db/schema'
import { scoreTopicIG } from '@/lib/quality/active-learning'

/**
 * Active-learning IG score per topic (Phase-12).
 *
 * Returns a Map<topicId, score ∈ [0, 1]>. Higher score = label this
 * topic next.
 *
 * Inputs the score combines:
 *   - Latest DS run posteriors for cells belonging to the topic
 *     (Phase-11 output). Topics not in the run get a max-entropy
 *     bootstrap so brand-new topics naturally rank high.
 *   - Distinct-rater count per topic (from submitted annotations).
 *
 * Caller passes the task scope so we don't pay for a workspace-wide
 * DS join when we only need one task's slice. When `taskIds` is empty,
 * returns an empty map.
 */
export async function getActiveLearningScores(opts: {
  workspaceId: string
  taskIds: string[]
}): Promise<Map<string, number>> {
  if (opts.taskIds.length === 0) return new Map()
  const db = getDb()

  // 1. Pull the latest DS run for this workspace (if any). Same logic
  //    as `getLatestDsRunReport` but we only need run id + K — skip
  //    the full report assembly.
  const [latestRun] = await db
    .select({ id: dsConsensusRuns.id, K: dsConsensusRuns.numClasses })
    .from(dsConsensusRuns)
    .where(eq(dsConsensusRuns.workspaceId, opts.workspaceId))
    .orderBy(desc(dsConsensusRuns.createdAt))
    .limit(1)

  // 2. Topic list for the requested tasks.
  const topicRows = await db
    .select({ id: topics.id })
    .from(topics)
    .where(inArray(topics.taskId, opts.taskIds))
  const topicIds = topicRows.map((t) => t.id)
  if (topicIds.length === 0) return new Map()

  // 3. Distinct-rater counts per topic — uses submitted annotations.
  //    `count(*)` over `DISTINCT user_id` would be more correct but
  //    drizzle's count() helper doesn't accept distinct directly;
  //    pull rows and dedupe in JS (workspace scale is fine — hundreds
  //    of topics, low single-digit raters each).
  const raterRows = await db
    .select({
      topicId: annotations.topicId,
      userId: annotations.userId,
    })
    .from(annotations)
    .where(
      and(
        inArray(annotations.topicId, topicIds),
        isNotNull(annotations.submittedAt),
      ),
    )
  const ratersByTopic = new Map<string, Set<string>>()
  for (const r of raterRows) {
    const set = ratersByTopic.get(r.topicId) ?? new Set<string>()
    set.add(r.userId)
    ratersByTopic.set(r.topicId, set)
  }

  // 4. DS-cell posteriors per topic (if a run exists).
  const cellsByTopic = new Map<string, number[][]>()
  if (latestRun) {
    const labelRows = await db
      .select({
        topicId: dsInferredLabels.topicId,
        posterior: dsInferredLabels.posterior,
      })
      .from(dsInferredLabels)
      .where(
        and(
          eq(dsInferredLabels.runId, latestRun.id),
          inArray(dsInferredLabels.topicId, topicIds),
        ),
      )
    for (const r of labelRows) {
      const post = r.posterior as Record<string, number> | null
      if (!post) continue
      // Reconstruct posterior array in 0..K-1 order so entropy is
      // computed correctly regardless of JSON key order.
      const arr = new Array<number>(latestRun.K).fill(0)
      for (let k = 0; k < latestRun.K; k++) {
        arr[k] = post[String(k)] ?? 0
      }
      const list = cellsByTopic.get(r.topicId) ?? []
      list.push(arr)
      cellsByTopic.set(r.topicId, list)
    }
  }

  // 5. Score each topic.
  const K = latestRun?.K ?? 2 // default K — used only for the maxEntropy
  // fallback; if there's no DS run, every topic gets cellPosteriors=[]
  // which collapses the entropy term to its max regardless of K.
  const out = new Map<string, number>()
  for (const id of topicIds) {
    const posteriors = cellsByTopic.get(id) ?? []
    const raters = ratersByTopic.get(id)?.size ?? 0
    out.set(
      id,
      scoreTopicIG({
        cellPosteriors: posteriors,
        K,
        raters,
      }),
    )
  }
  return out
}

/** Single-workspace variant — convenience for /my/queue style callers
 *  that want the whole workspace at once. Pulls the task ids first. */
export async function getActiveLearningScoresForWorkspace(
  workspaceId: string,
): Promise<Map<string, number>> {
  const db = getDb()
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.workspaceId, workspaceId))
  return getActiveLearningScores({
    workspaceId,
    taskIds: rows.map((r) => r.id),
  })
}

// Silence unused-imports — drizzle's count helper kept for future
// alternative implementations.
void count
