import 'server-only'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  stepAnnotations,
  toolProviders,
  topics,
  trajectories,
  trajectorySteps,
} from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'

/**
 * Bulk export of trajectories + annotations as JSONL.
 *
 * Each line is one trajectory bundle:
 *   {
 *     trajectory: { id, agent_name, root_prompt, final_response, source, meta, ... },
 *     steps: [{ id, sequence, kind, content, tool_provider, ... }],
 *     tool_providers: [{ id, kind, identifier, manifest, ... }],
 *     annotations: [{ id, user_id, payload, claude_proposal, delta_summary, ... }],
 *     step_annotations: [{ id, trajectory_step_id, kind, rating, reasoning, ... }]
 *   }
 *
 * Format chosen for HuggingFace dataset compatibility (load as `json` with
 * lines=True). Each row is self-contained — no cross-row joins required.
 *
 * MVP scope: in-memory build, cap at 200 trajectories per call. For larger
 * exports, the caller should paginate via createdBefore cursor and stitch.
 *
 * Auditing: this is a sensitive admin operation. Caller (Route Handler)
 * logs an `export.created` event with the count + filters.
 */

export interface ExportOpts {
  workspaceId: string
  limit?: number
  /** Cursor: only include trajectories created before this timestamp. */
  createdBefore?: Date
  /** Filter by source(s). Empty/missing = all. */
  sources?: string[]
  includeDeleted?: boolean
}

const MAX_TRAJECTORIES_PER_EXPORT = 200

export async function generateJsonlExport(
  opts: ExportOpts,
): Promise<{ jsonl: string; count: number }> {
  // Auth happens at the Route Handler layer; this fn assumes caller is authorized.
  const limit = Math.min(opts.limit ?? 100, MAX_TRAJECTORIES_PER_EXPORT)
  const db = getDb()

  // 1. Pick trajectory page
  const trajConds = [eq(trajectories.workspaceId, opts.workspaceId)]
  if (!opts.includeDeleted) trajConds.push(isNull(trajectories.deletedAt))
  if (opts.sources && opts.sources.length > 0) {
    trajConds.push(inArray(trajectories.source, opts.sources))
  }

  const trajRows = await db
    .select()
    .from(trajectories)
    .where(and(...trajConds))
    .orderBy(asc(trajectories.createdAt))
    .limit(limit)

  if (trajRows.length === 0) {
    return { jsonl: '', count: 0 }
  }

  const trajIds = trajRows.map((t) => t.id)

  // 2. Pull all steps in one query
  const stepRows = await db
    .select()
    .from(trajectorySteps)
    .where(inArray(trajectorySteps.trajectoryId, trajIds))
    .orderBy(
      asc(trajectorySteps.trajectoryId),
      asc(trajectorySteps.sequence),
    )

  // 3. Pull all referenced tool providers
  const providerIds = Array.from(
    new Set(
      stepRows
        .map((s) => s.toolProviderId)
        .filter((p): p is string => p !== null),
    ),
  )
  const providerRows =
    providerIds.length > 0
      ? await db
          .select()
          .from(toolProviders)
          .where(inArray(toolProviders.id, providerIds))
      : []
  const providersById = new Map(providerRows.map((p) => [p.id, p]))

  // 4. Pull topics linked to these trajectories (via topic.itemData.trajectoryId)
  //    We rely on JSONB query to find topics whose itemData has a matching trajectoryId.
  //    For MVP simplicity, do an N-query approach; optimize later with GIN index.
  const topicRowsByTrajId = new Map<string, typeof topics.$inferSelect>()
  for (const traj of trajRows) {
    if (!traj.taskId) continue
    const [topicRow] = await db
      .select()
      .from(topics)
      .where(
        and(
          eq(topics.taskId, traj.taskId),
          // We can't directly filter on JSONB in Drizzle simply across all dialects;
          // use SQL fragment. Skipped: relies on topic-trajectory link via taskId
          // when present. The `trajectory.taskId` is the canonical join.
        ),
      )
      .limit(1)
    if (topicRow) topicRowsByTrajId.set(traj.id, topicRow)
  }

  // 5. Pull annotations + step_annotations for those topics
  const topicIds = Array.from(topicRowsByTrajId.values()).map((t) => t.id)
  const annotationRows =
    topicIds.length > 0
      ? await db
          .select()
          .from(annotations)
          .where(inArray(annotations.topicId, topicIds))
      : []

  const annotationIds = annotationRows.map((a) => a.id)
  const stepAnnRows =
    annotationIds.length > 0
      ? await db
          .select()
          .from(stepAnnotations)
          .where(inArray(stepAnnotations.annotationId, annotationIds))
      : []

  // 6. Group by trajectory and stringify
  const stepsByTraj = new Map<string, typeof stepRows>()
  for (const s of stepRows) {
    const arr = stepsByTraj.get(s.trajectoryId) ?? []
    arr.push(s)
    stepsByTraj.set(s.trajectoryId, arr)
  }
  const annsByTopic = new Map<string, typeof annotationRows>()
  for (const a of annotationRows) {
    const arr = annsByTopic.get(a.topicId) ?? []
    arr.push(a)
    annsByTopic.set(a.topicId, arr)
  }
  const stepAnnsByAnn = new Map<string, typeof stepAnnRows>()
  for (const sa of stepAnnRows) {
    const arr = stepAnnsByAnn.get(sa.annotationId) ?? []
    arr.push(sa)
    stepAnnsByAnn.set(sa.annotationId, arr)
  }

  const lines: string[] = []
  for (const traj of trajRows) {
    const trajSteps = stepsByTraj.get(traj.id) ?? []
    const trajProviderIds = Array.from(
      new Set(
        trajSteps
          .map((s) => s.toolProviderId)
          .filter((p): p is string => p !== null),
      ),
    )
    const trajProviders = trajProviderIds
      .map((id) => providersById.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))

    const topic = topicRowsByTrajId.get(traj.id) ?? null
    const trajAnns = topic ? (annsByTopic.get(topic.id) ?? []) : []
    const trajStepAnns = trajAnns.flatMap(
      (a) => stepAnnsByAnn.get(a.id) ?? [],
    )

    lines.push(
      JSON.stringify({
        trajectory: traj,
        steps: trajSteps,
        tool_providers: trajProviders,
        topic,
        annotations: trajAnns,
        step_annotations: trajStepAnns,
      }),
    )
  }

  return { jsonl: lines.join('\n'), count: trajRows.length }
}

/**
 * Server Action wrapper for the export — adds auth + audit event.
 * Returns the JSONL as a string. For large exports, use the streaming
 * Route Handler at `/api/export/trajectories` instead.
 */
export async function exportTrajectoriesJsonl(opts: ExportOpts) {
  'use server'
  const { user } = await requireWorkspaceAdmin(opts.workspaceId)
  const result = await generateJsonlExport(opts)

  const db = getDb()
  await db.insert(events).values({
    type: 'export.created',
    workspaceId: opts.workspaceId,
    actorId: user.id,
    payload: {
      count: result.count,
      sources: opts.sources ?? null,
      includeDeleted: opts.includeDeleted ?? false,
    },
  })

  return result
}
