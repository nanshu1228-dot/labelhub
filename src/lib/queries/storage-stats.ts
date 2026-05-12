import 'server-only'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  stepAnnotations,
  tasks,
  toolProviders,
  topics,
  trajectories,
  trajectorySteps,
} from '@/lib/db/schema'

/**
 * Workspace storage stats — powers the "Data Management" overview page.
 *
 * Designed for snappy dashboard loads: all counts are unindexed-friendly
 * (single equality scan per table). For larger workspaces (>1M rows),
 * replace with cached materialized views.
 */

export interface WorkspaceStorageStats {
  workspaceId: string
  trajectories: { total: number; deleted: number; bySource: Array<{ source: string; n: number }> }
  trajectorySteps: number
  toolProviders: { total: number; declared: number; inferred: number; byKind: Array<{ kind: string; n: number }> }
  tasks: number
  topics: number
  annotations: number
  stepAnnotations: number
}

export async function getWorkspaceStorageStats(
  workspaceId: string,
): Promise<WorkspaceStorageStats> {
  const db = getDb()

  // Trajectories total + soft-deleted
  const [trajCounts] = await db
    .select({
      total: count(),
      deleted: sql<number>`SUM(CASE WHEN ${trajectories.deletedAt} IS NOT NULL THEN 1 ELSE 0 END)::int`,
    })
    .from(trajectories)
    .where(eq(trajectories.workspaceId, workspaceId))

  const trajBySource = await db
    .select({ source: trajectories.source, n: count() })
    .from(trajectories)
    .where(
      and(
        eq(trajectories.workspaceId, workspaceId),
        isNull(trajectories.deletedAt),
      ),
    )
    .groupBy(trajectories.source)

  // Trajectory steps total (via JOIN — could be denormalized later)
  const [stepsTotal] = await db
    .select({ n: count() })
    .from(trajectorySteps)
    .innerJoin(
      trajectories,
      eq(trajectorySteps.trajectoryId, trajectories.id),
    )
    .where(eq(trajectories.workspaceId, workspaceId))

  // Tool providers
  const [providersTotal] = await db
    .select({
      total: count(),
      declared: sql<number>`SUM(CASE WHEN ${toolProviders.source} = 'declared' THEN 1 ELSE 0 END)::int`,
      inferred: sql<number>`SUM(CASE WHEN ${toolProviders.source} = 'inferred' THEN 1 ELSE 0 END)::int`,
    })
    .from(toolProviders)
    .where(eq(toolProviders.workspaceId, workspaceId))

  const providersByKind = await db
    .select({ kind: toolProviders.kind, n: count() })
    .from(toolProviders)
    .where(eq(toolProviders.workspaceId, workspaceId))
    .groupBy(toolProviders.kind)

  // Tasks
  const [tasksTotal] = await db
    .select({ n: count() })
    .from(tasks)
    .where(eq(tasks.workspaceId, workspaceId))

  // Topics (via JOIN with tasks)
  const [topicsTotal] = await db
    .select({ n: count() })
    .from(topics)
    .innerJoin(tasks, eq(topics.taskId, tasks.id))
    .where(eq(tasks.workspaceId, workspaceId))

  // Annotations
  const [annotationsTotal] = await db
    .select({ n: count() })
    .from(annotations)
    .innerJoin(topics, eq(annotations.topicId, topics.id))
    .innerJoin(tasks, eq(topics.taskId, tasks.id))
    .where(eq(tasks.workspaceId, workspaceId))

  // Step annotations
  const [stepAnnotationsTotal] = await db
    .select({ n: count() })
    .from(stepAnnotations)
    .innerJoin(annotations, eq(stepAnnotations.annotationId, annotations.id))
    .innerJoin(topics, eq(annotations.topicId, topics.id))
    .innerJoin(tasks, eq(topics.taskId, tasks.id))
    .where(eq(tasks.workspaceId, workspaceId))

  return {
    workspaceId,
    trajectories: {
      total: trajCounts?.total ?? 0,
      deleted: trajCounts?.deleted ?? 0,
      bySource: trajBySource,
    },
    trajectorySteps: stepsTotal?.n ?? 0,
    toolProviders: {
      total: providersTotal?.total ?? 0,
      declared: providersTotal?.declared ?? 0,
      inferred: providersTotal?.inferred ?? 0,
      byKind: providersByKind,
    },
    tasks: tasksTotal?.n ?? 0,
    topics: topicsTotal?.n ?? 0,
    annotations: annotationsTotal?.n ?? 0,
    stepAnnotations: stepAnnotationsTotal?.n ?? 0,
  }
}
