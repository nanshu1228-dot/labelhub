import 'server-only'
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  dsConsensusRuns,
  dsInferredLabels,
  dsRaterConfusion,
  tasks,
  topics,
  users,
} from '@/lib/db/schema'
import type {
  DsRunReport,
  DsRaterRow,
  DsTopicCell,
  DsTopicSummary,
} from '@/lib/quality/dawid-skene-display'

// Re-export the display module's types and helpers so existing import
// sites that pulled from this file keep working (and client components
// import the display module directly to dodge the server-only boundary).
export {
  describeCellKey,
  formatInferredClass,
} from '@/lib/quality/dawid-skene-display'
export type {
  DsRunReport,
  DsRunSummary,
  DsRaterRow,
  DsTopicCell,
  DsTopicSummary,
} from '@/lib/quality/dawid-skene-display'

/**
 * Pull the most recent DS run for the workspace + everything needed to
 * render the /quality DS section. Returns null when no run exists.
 */
export async function getLatestDsRunReport(
  workspaceId: string,
): Promise<DsRunReport | null> {
  const db = getDb()
  const [run] = await db
    .select()
    .from(dsConsensusRuns)
    .where(eq(dsConsensusRuns.workspaceId, workspaceId))
    .orderBy(desc(dsConsensusRuns.createdAt))
    .limit(1)
  if (!run) return null

  const [labelRows, raterRows] = await Promise.all([
    db
      .select({
        topicId: dsInferredLabels.topicId,
        cellKey: dsInferredLabels.cellKey,
        inferredClass: dsInferredLabels.inferredClass,
        confidence: dsInferredLabels.confidence,
        posterior: dsInferredLabels.posterior,
        voteCount: dsInferredLabels.voteCount,
      })
      .from(dsInferredLabels)
      .where(eq(dsInferredLabels.runId, run.id)),
    db
      .select({
        userId: dsRaterConfusion.userId,
        displayName: users.displayName,
        confusion: dsRaterConfusion.confusion,
        nObservations: dsRaterConfusion.nObservations,
        accuracy: dsRaterConfusion.accuracy,
        biasSummary: dsRaterConfusion.biasSummary,
      })
      .from(dsRaterConfusion)
      .leftJoin(users, eq(users.id, dsRaterConfusion.userId))
      .where(eq(dsRaterConfusion.runId, run.id)),
  ])

  // Group label rows by topic.
  const byTopic = new Map<string, DsTopicCell[]>()
  for (const r of labelRows) {
    const list = byTopic.get(r.topicId) ?? []
    list.push({
      cellKey: r.cellKey,
      inferredClass: r.inferredClass,
      confidence: r.confidence,
      posterior: (r.posterior ?? {}) as Record<string, number>,
      voteCount: r.voteCount,
    })
    byTopic.set(r.topicId, list)
  }

  const topicSummaries: DsTopicSummary[] = []
  for (const [topicId, cells] of byTopic) {
    const conf = cells.map((c) => c.confidence)
    const mean = conf.reduce((a, b) => a + b, 0) / conf.length
    const min = Math.min(...conf)
    topicSummaries.push({
      topicId,
      meanConfidence: mean,
      cellCount: cells.length,
      minConfidence: min,
      cells: cells.sort((a, b) => a.cellKey.localeCompare(b.cellKey)),
    })
  }
  topicSummaries.sort((a, b) => a.minConfidence - b.minConfidence)

  const raters: DsRaterRow[] = raterRows
    .map((r) => ({
      userId: r.userId,
      displayName: r.displayName,
      confusion: (r.confusion ?? []) as number[][],
      nObservations: r.nObservations,
      accuracy: r.accuracy,
      biasSummary: r.biasSummary,
    }))
    .sort((a, b) => b.accuracy - a.accuracy)

  return {
    run: {
      runId: run.id,
      templateMode: run.templateMode,
      numClasses: run.numClasses,
      cellCount: run.cellCount,
      raterCount: run.raterCount,
      iterations: run.iterations,
      converged: run.converged,
      logLikelihood: run.logLikelihood,
      createdAt: run.createdAt,
    },
    raters,
    topics: topicSummaries,
  }
}

/**
 * Count submitted annotations newer than the run timestamp — drives the
 * "X new submissions since DS ran" staleness hint in the UI. Returns 0
 * when no run exists or no fresher work has arrived.
 *
 * Why a separate query: pulling this in the main `getLatestDsRunReport`
 * adds a join the admin doesn't always need (e.g. on the audit-log
 * surface). Keep it cheap and opt-in.
 */
export async function countAnnotationsSinceLatestDsRun(opts: {
  workspaceId: string
  templateMode: string
}): Promise<{
  hasRun: boolean
  newSubmissions: number
  runCreatedAt: Date | null
}> {
  const db = getDb()
  const [run] = await db
    .select({ createdAt: dsConsensusRuns.createdAt })
    .from(dsConsensusRuns)
    .where(eq(dsConsensusRuns.workspaceId, opts.workspaceId))
    .orderBy(desc(dsConsensusRuns.createdAt))
    .limit(1)
  if (!run) {
    return { hasRun: false, newSubmissions: 0, runCreatedAt: null }
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .where(
      and(
        eq(tasks.workspaceId, opts.workspaceId),
        eq(tasks.templateMode, opts.templateMode),
        gt(annotations.submittedAt, run.createdAt),
      ),
    )
  return {
    hasRun: true,
    newSubmissions: Number(row?.n ?? 0),
    runCreatedAt: run.createdAt,
  }
}
