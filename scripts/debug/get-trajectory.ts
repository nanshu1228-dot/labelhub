/**
 * get_trajectory — full row + ordered steps, with tool_provider names joined in.
 *
 * Returns the canonical jsonb `content` per step (NOT a preview) so Claude can
 * read the actual tool args / tool output / final-response text. If you want
 * just the summary, call list_trajectories instead.
 *
 * Run: `tsx scripts/debug/get-trajectory.ts --id <uuid>`
 */
import { eq } from 'drizzle-orm'
import { cliRun, isMain, parseArgs, positionals } from './_shared/args'
import { withDb, schema } from './_shared/db'

export interface GetTrajectoryArgs {
  id: string
}

export interface TrajectoryStepDetail {
  id: string
  sequence: number
  kind: string
  content: unknown
  toolCallId: string | null
  toolProvider: {
    id: string
    name: string
    kind: string
    identifier: string
    source: string
  } | null
  latencyMs: number | null
  tokensIn: number | null
  tokensOut: number | null
  modelName: string | null
  ts: string
}

export interface GetTrajectoryResult {
  trajectory: {
    id: string
    workspaceId: string
    taskId: string | null
    source: string
    agentName: string
    rootPrompt: string
    finalResponse: string | null
    meta: unknown
    schemaVersion: string
    createdAt: string
    deletedAt: string | null
  }
  steps: TrajectoryStepDetail[]
}

export async function runGetTrajectory(
  args: GetTrajectoryArgs,
): Promise<GetTrajectoryResult> {
  if (!args.id) {
    throw new Error('id is required')
  }

  return withDb(async ({ db }) => {
    const [t] = await db
      .select()
      .from(schema.trajectories)
      .where(eq(schema.trajectories.id, args.id))
      .limit(1)
    if (!t) {
      throw new Error(`Trajectory not found: ${args.id}`)
    }

    const rows = await db
      .select({
        id: schema.trajectorySteps.id,
        sequence: schema.trajectorySteps.sequence,
        kind: schema.trajectorySteps.kind,
        content: schema.trajectorySteps.content,
        toolCallId: schema.trajectorySteps.toolCallId,
        latencyMs: schema.trajectorySteps.latencyMs,
        tokensIn: schema.trajectorySteps.tokensIn,
        tokensOut: schema.trajectorySteps.tokensOut,
        modelName: schema.trajectorySteps.modelName,
        ts: schema.trajectorySteps.ts,
        providerId: schema.toolProviders.id,
        providerName: schema.toolProviders.name,
        providerKind: schema.toolProviders.kind,
        providerIdentifier: schema.toolProviders.identifier,
        providerSource: schema.toolProviders.source,
      })
      .from(schema.trajectorySteps)
      .leftJoin(
        schema.toolProviders,
        eq(schema.trajectorySteps.toolProviderId, schema.toolProviders.id),
      )
      .where(eq(schema.trajectorySteps.trajectoryId, args.id))
      .orderBy(schema.trajectorySteps.sequence)

    return {
      trajectory: {
        id: t.id,
        workspaceId: t.workspaceId,
        taskId: t.taskId,
        source: t.source,
        agentName: t.agentName,
        rootPrompt: t.rootPrompt,
        finalResponse: t.finalResponse,
        meta: t.meta,
        schemaVersion: t.schemaVersion,
        createdAt: t.createdAt.toISOString(),
        deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
      },
      steps: rows.map((r) => ({
        id: r.id,
        sequence: r.sequence,
        kind: r.kind,
        content: r.content,
        toolCallId: r.toolCallId,
        toolProvider: r.providerId
          ? {
              id: r.providerId,
              name: r.providerName!,
              kind: r.providerKind!,
              identifier: r.providerIdentifier!,
              source: r.providerSource!,
            }
          : null,
        latencyMs: r.latencyMs,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        modelName: r.modelName,
        ts: r.ts.toISOString(),
      })),
    }
  })
}

if (isMain(import.meta.url)) {
  void cliRun(async () => {
    const a = parseArgs(process.argv.slice(2))
    const id = (typeof a.id === 'string' ? a.id : undefined) ?? positionals(a)[0]
    if (!id) {
      throw new Error('Missing --id (or positional UUID).')
    }
    return runGetTrajectory({ id: String(id) })
  })
}
