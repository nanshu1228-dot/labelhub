/**
 * list_trajectories — most recent first, optionally filtered.
 *
 * Optimized for "let me peek at what the SDK / proxy / eval-run has captured."
 * Soft-deleted rows are excluded by default (matches the production index).
 *
 * Run:
 *   tsx scripts/debug/list-trajectories.ts --workspace <uuid> --limit 20
 *   tsx scripts/debug/list-trajectories.ts --agent doubao/doubao-1-5-pro --source production
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { cliRun, isMain, parseArgs } from './_shared/args'
import { withDb, schema } from './_shared/db'
import { DEMO_WORKSPACE_ID } from './_shared/api-key'

export interface ListTrajectoriesArgs {
  workspaceId?: string
  agentName?: string
  source?: string
  limit?: number
  includeDeleted?: boolean
}

export interface TrajectoryListItem {
  id: string
  workspaceId: string
  taskId: string | null
  agentName: string
  source: string
  stepCount: number
  finalResponsePreview: string | null
  createdAt: string
  deletedAt: string | null
}

export interface ListTrajectoriesResult {
  total: number
  items: TrajectoryListItem[]
  filters: {
    workspaceId: string
    agentName: string | null
    source: string | null
    includeDeleted: boolean
    limit: number
  }
}

export async function runListTrajectories(
  args: ListTrajectoriesArgs,
): Promise<ListTrajectoriesResult> {
  const workspaceId = args.workspaceId ?? DEMO_WORKSPACE_ID
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 200)
  const includeDeleted = args.includeDeleted === true

  return withDb(async ({ db }) => {
    const conditions = [eq(schema.trajectories.workspaceId, workspaceId)]
    if (args.agentName) {
      conditions.push(eq(schema.trajectories.agentName, args.agentName))
    }
    if (args.source) {
      conditions.push(eq(schema.trajectories.source, args.source))
    }
    if (!includeDeleted) {
      conditions.push(isNull(schema.trajectories.deletedAt))
    }
    const where = conditions.length === 1 ? conditions[0] : and(...conditions)

    // Single round-trip: join trajectories with their step count.
    const rows = await db
      .select({
        id: schema.trajectories.id,
        workspaceId: schema.trajectories.workspaceId,
        taskId: schema.trajectories.taskId,
        agentName: schema.trajectories.agentName,
        source: schema.trajectories.source,
        finalResponse: schema.trajectories.finalResponse,
        createdAt: schema.trajectories.createdAt,
        deletedAt: schema.trajectories.deletedAt,
        stepCount: sql<number>`count(${schema.trajectorySteps.id})::int`.as(
          'step_count',
        ),
      })
      .from(schema.trajectories)
      .leftJoin(
        schema.trajectorySteps,
        eq(schema.trajectorySteps.trajectoryId, schema.trajectories.id),
      )
      .where(where)
      .groupBy(schema.trajectories.id)
      .orderBy(desc(schema.trajectories.createdAt))
      .limit(limit)

    return {
      total: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        taskId: r.taskId,
        agentName: r.agentName,
        source: r.source,
        stepCount: Number(r.stepCount ?? 0),
        finalResponsePreview: r.finalResponse ? r.finalResponse.slice(0, 200) : null,
        createdAt: r.createdAt.toISOString(),
        deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
      })),
      filters: {
        workspaceId,
        agentName: args.agentName ?? null,
        source: args.source ?? null,
        includeDeleted,
        limit,
      },
    }
  })
}

if (isMain(import.meta.url)) {
  void cliRun(async () => {
    const a = parseArgs(process.argv.slice(2))
    return runListTrajectories({
      workspaceId: a.workspace ? String(a.workspace) : undefined,
      agentName: a.agent ? String(a.agent) : undefined,
      source: a.source ? String(a.source) : undefined,
      limit: a.limit ? Number(a.limit) : undefined,
      includeDeleted: a.includeDeleted === true,
    })
  })
}
