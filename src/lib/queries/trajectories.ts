import 'server-only'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  type SQL,
} from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  stepAnnotations,
  toolProviders,
  trajectories,
  trajectorySteps,
} from '@/lib/db/schema'
import type { TrajectorySource } from '@/lib/trajectories/schema'

/**
 * Trajectory read-side queries.
 *
 * All queries filter out soft-deleted (deletedAt IS NOT NULL) by default.
 * Pass `includeDeleted: true` to include them (admin/audit views).
 */

export async function getTrajectoryById(
  id: string,
  opts?: { includeDeleted?: boolean },
) {
  const db = getDb()
  const conditions = opts?.includeDeleted
    ? eq(trajectories.id, id)
    : and(eq(trajectories.id, id), isNull(trajectories.deletedAt))
  const [traj] = await db
    .select()
    .from(trajectories)
    .where(conditions)
    .limit(1)
  return traj ?? null
}

/**
 * Full trajectory hydration for annotation UI.
 * Single JOIN to fetch tool_providers in one round trip.
 */
export async function getTrajectoryWithSteps(
  id: string,
  opts?: { includeDeleted?: boolean },
) {
  const traj = await getTrajectoryById(id, opts)
  if (!traj) return null

  const db = getDb()
  const steps = await db
    .select()
    .from(trajectorySteps)
    .where(eq(trajectorySteps.trajectoryId, id))
    .orderBy(asc(trajectorySteps.sequence))

  const providerIds = Array.from(
    new Set(
      steps
        .map((s) => s.toolProviderId)
        .filter((pid): pid is string => pid !== null),
    ),
  )
  const providers =
    providerIds.length > 0
      ? await db
          .select()
          .from(toolProviders)
          .where(inArray(toolProviders.id, providerIds))
      : []
  const providersById = new Map(providers.map((p) => [p.id, p]))

  return { trajectory: traj, steps, providersById }
}

export async function listTrajectoriesInWorkspace(
  workspaceId: string,
  opts?: { limit?: number; offset?: number; includeDeleted?: boolean },
) {
  const db = getDb()
  const limit = Math.min(opts?.limit ?? 50, 200)
  const baseCondition = opts?.includeDeleted
    ? eq(trajectories.workspaceId, workspaceId)
    : and(
        eq(trajectories.workspaceId, workspaceId),
        isNull(trajectories.deletedAt),
      )
  return db
    .select()
    .from(trajectories)
    .where(baseCondition)
    .orderBy(desc(trajectories.createdAt))
    .limit(limit)
    .offset(opts?.offset ?? 0)
}

/**
 * Recent trajectories + per-row step counts, in one round-trip.
 *
 * Used by the workspace's trajectory list page. We join trajectories ⨝
 * trajectory_steps and aggregate; rows with zero steps still appear (left join).
 * Returns the trajectory row plus { stepCount } and the per-kind step
 * histogram so the list can show "3 thinking · 2 tool_call · 1 final".
 */
export async function listTrajectoriesWithStepStats(
  workspaceId: string,
  opts?: { limit?: number; offset?: number },
) {
  const db = getDb()
  const limit = Math.min(opts?.limit ?? 50, 200)
  const offset = opts?.offset ?? 0

  // Page of trajectories first (smaller working set).
  const trajList = await listTrajectoriesInWorkspace(workspaceId, {
    limit,
    offset,
  })
  if (trajList.length === 0) return []

  // Single IN-list query for all steps belonging to this page.
  const trajIds = trajList.map((t) => t.id)
  const steps = await db
    .select({
      trajectoryId: trajectorySteps.trajectoryId,
      kind: trajectorySteps.kind,
    })
    .from(trajectorySteps)
    .where(inArray(trajectorySteps.trajectoryId, trajIds))

  // Bucket by trajectoryId then by kind.
  const byTraj = new Map<string, { total: number; byKind: Record<string, number> }>()
  for (const s of steps) {
    const bucket =
      byTraj.get(s.trajectoryId) ?? { total: 0, byKind: {} as Record<string, number> }
    bucket.total += 1
    bucket.byKind[s.kind] = (bucket.byKind[s.kind] ?? 0) + 1
    byTraj.set(s.trajectoryId, bucket)
  }

  // How many of those steps have at least one step_annotation? Distinct so
  // re-saves don't inflate the number. Single query, then bucket by trajectory.
  const stepIds = steps.map((s) => s.trajectoryId) // unused, kept readable
  void stepIds
  const markedRaw = await db
    .selectDistinct({
      trajectoryId: trajectorySteps.trajectoryId,
      stepId: trajectorySteps.id,
    })
    .from(stepAnnotations)
    .innerJoin(
      trajectorySteps,
      eq(stepAnnotations.trajectoryStepId, trajectorySteps.id),
    )
    .where(inArray(trajectorySteps.trajectoryId, trajIds))
  const markedByTraj = new Map<string, number>()
  for (const r of markedRaw) {
    markedByTraj.set(r.trajectoryId, (markedByTraj.get(r.trajectoryId) ?? 0) + 1)
  }

  return trajList.map((t) => ({
    ...t,
    stepCount: byTraj.get(t.id)?.total ?? 0,
    stepsByKind: byTraj.get(t.id)?.byKind ?? {},
    markedStepCount: markedByTraj.get(t.id) ?? 0,
  }))
}

// ───────────────────────────────────────────────────────────────────────
// Search — the workhorse query for the "Data Management" view.
// ───────────────────────────────────────────────────────────────────────

export interface TrajectorySearchFilters {
  /** Substring match on agentName (ILIKE — case-insensitive) */
  agentName?: string
  /** Exact source, OR multiple sources (IN) */
  source?: TrajectorySource | TrajectorySource[]
  createdAfter?: Date
  createdBefore?: Date
  includeDeleted?: boolean
}

export interface TrajectorySearchResult {
  trajectories: Array<typeof trajectories.$inferSelect>
  total: number
  hasMore: boolean
  limit: number
  offset: number
}

export async function searchTrajectories(opts: {
  workspaceId: string
  filters?: TrajectorySearchFilters
  limit?: number
  offset?: number
}): Promise<TrajectorySearchResult> {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 50, 200)
  const offset = opts.offset ?? 0
  const filters = opts.filters ?? {}

  const conds: SQL[] = [eq(trajectories.workspaceId, opts.workspaceId)]
  if (!filters.includeDeleted) {
    conds.push(isNull(trajectories.deletedAt))
  }
  if (filters.agentName) {
    conds.push(ilike(trajectories.agentName, `%${filters.agentName}%`))
  }
  if (filters.source) {
    if (Array.isArray(filters.source)) {
      if (filters.source.length > 0) {
        conds.push(inArray(trajectories.source, filters.source))
      }
    } else {
      conds.push(eq(trajectories.source, filters.source))
    }
  }
  if (filters.createdAfter) {
    conds.push(gte(trajectories.createdAt, filters.createdAfter))
  }
  if (filters.createdBefore) {
    conds.push(lte(trajectories.createdAt, filters.createdBefore))
  }

  const whereExpr = conds.length === 1 ? conds[0] : and(...conds)

  // Total count (for pagination UI)
  const [totalRow] = await db
    .select({ n: count() })
    .from(trajectories)
    .where(whereExpr)
  const total = totalRow?.n ?? 0

  // Page of results
  const rows = await db
    .select()
    .from(trajectories)
    .where(whereExpr)
    .orderBy(desc(trajectories.createdAt))
    .limit(limit)
    .offset(offset)

  return {
    trajectories: rows,
    total,
    hasMore: offset + rows.length < total,
    limit,
    offset,
  }
}
