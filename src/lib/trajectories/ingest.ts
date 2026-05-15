import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  events,
  toolProviders,
  trajectories,
  trajectorySteps,
} from '@/lib/db/schema'
import { ValidationError } from '@/lib/errors'
import { adaptAnthropic } from './adapters/anthropic'
import { adaptCanonical } from './adapters/canonical'
import { adaptOpenAIAssistants } from './adapters/openai-assistants'
import { detectFormat, type DetectedFormat } from './detect'
import {
  type CanonicalTrajectory,
  type ToolProviderKind,
  type TrajectorySource,
} from './schema'
import { extractFeatures } from './extract-features'

/**
 * Trajectory ingest orchestrator.
 *
 * Responsibilities:
 *   1. Detect format (or honor caller override)
 *   2. Run the right adapter → canonical
 *   3. Persist trajectory + steps in a single DB pass
 *   4. Auto-create or refresh `tool_providers` (inferred) for each tool_call step
 *   5. Emit `trajectory.ingested` event for Pillar 2 audit + Live Learning updates
 *
 * Security: this function NEVER outbound-calls publisher tools or executes code.
 * It only persists what the caller sent us.
 */

export interface IngestInput {
  workspaceId: string
  agentName: string
  source: TrajectorySource
  /** Force a specific adapter; otherwise auto-detected. */
  format?: DetectedFormat
  /** Optional: emit events under this actor (for audit). Pass null for system ingest. */
  actorId?: string | null
  /** Optional: tie the trajectory to a task immediately. */
  taskId?: string | null
  /** Raw payload from the caller — any format the adapter layer knows. */
  payload: unknown
}

export interface IngestResult {
  trajectoryId: string
  stepCount: number
  format: DetectedFormat
  providersInferred: number
}

/**
 * Adapt raw payload into canonical form. Pure function — no DB, no I/O.
 */
export function adaptToCanonical(input: {
  payload: unknown
  format?: DetectedFormat
  agentName: string
  source: TrajectorySource
}): { trajectory: CanonicalTrajectory; format: DetectedFormat } {
  const detected = input.format ?? detectFormat(input.payload)
  switch (detected) {
    case 'canonical':
      return {
        trajectory: adaptCanonical(input.payload, {
          agentName: input.agentName,
          source: input.source,
        }),
        format: 'canonical',
      }
    case 'anthropic':
      return {
        trajectory: adaptAnthropic(input.payload, {
          agentName: input.agentName,
          source: input.source,
        }),
        format: 'anthropic',
      }
    case 'openai-assistants':
      return {
        trajectory: adaptOpenAIAssistants(input.payload, {
          agentName: input.agentName,
          source: input.source,
        }),
        format: 'openai-assistants',
      }
    default:
      throw new ValidationError(
        'Unrecognized trajectory format. Supply X-LabelHub-Format header or use the canonical schema.',
      )
  }
}

/**
 * Persist a canonical trajectory and its steps. Resolves tool_providers
 * (auto-creating inferred ones when unknown).
 *
 * Returns count of providers newly created during this ingest so callers
 * can surface "we found 3 new tools in this run" hints.
 */
export async function persistTrajectory(opts: {
  workspaceId: string
  taskId?: string | null
  trajectory: CanonicalTrajectory
  actorId?: string | null
}): Promise<IngestResult & { trajectory: CanonicalTrajectory }> {
  const db = getDb()

  const [traj] = await db
    .insert(trajectories)
    .values({
      workspaceId: opts.workspaceId,
      taskId: opts.taskId ?? null,
      source: opts.trajectory.source,
      agentName: opts.trajectory.agentName,
      rootPrompt: opts.trajectory.rootPrompt,
      finalResponse: opts.trajectory.finalResponse ?? null,
      meta: opts.trajectory.meta ?? {},
      schemaVersion: opts.trajectory.schemaVersion,
    })
    .returning()

  let providersInferred = 0

  for (const step of opts.trajectory.steps) {
    let toolProviderId: string | null = null
    let toolCallId: string | null = null

    if (step.kind === 'tool_call') {
      const c = step.content as {
        toolCallId: string
        toolName: string
        providerKind?: ToolProviderKind
        providerHint?: {
          mcpServer?: string
          mcpCapability?: string
          cliCommand?: string
          skillName?: string
          apiOperationId?: string
        }
      }
      toolCallId = c.toolCallId
      const kind = c.providerKind ?? 'function'
      const identifier = buildProviderIdentifier(kind, c)

      // Upsert provider row. ON CONFLICT updates lastSeenAt only — preserves
      // 'declared' source if publisher already promoted this provider.
      const [provider] = await db
        .insert(toolProviders)
        .values({
          workspaceId: opts.workspaceId,
          kind,
          identifier,
          name: c.toolName,
          source: 'inferred',
          manifest: {},
        })
        .onConflictDoUpdate({
          target: [toolProviders.workspaceId, toolProviders.identifier],
          set: { lastSeenAt: sql`now()` },
        })
        .returning()

      // Count only truly new ones (firstSeenAt within last few seconds).
      if (
        provider &&
        provider.firstSeenAt &&
        Date.now() - provider.firstSeenAt.getTime() < 5_000
      ) {
        providersInferred++
      }

      toolProviderId = provider.id
    } else if (step.kind === 'tool_result') {
      toolCallId = (step.content as { toolCallId: string }).toolCallId
    }

    await db.insert(trajectorySteps).values({
      trajectoryId: traj.id,
      parentStepId: step.parentStepId ?? null,
      sequence: step.sequence,
      kind: step.kind,
      content: step.content,
      toolProviderId,
      toolCallId,
      latencyMs: step.latencyMs ?? null,
      tokensIn: step.tokensIn ?? null,
      tokensOut: step.tokensOut ?? null,
      modelName: step.modelName ?? null,
      ts: step.ts ? new Date(step.ts) : new Date(),
    })
  }

  // Compute + persist structured features for the /analyze page filter UI
  // + the LLM batch-analyst. Pure function, no LLM, fast. Reads the rows we
  // just inserted to get authoritative createdAt timestamps.
  try {
    const insertedSteps = await db
      .select()
      .from(trajectorySteps)
      .where(eq(trajectorySteps.trajectoryId, traj.id))
    const features = extractFeatures(insertedSteps)
    await db
      .update(trajectories)
      .set({ features })
      .where(eq(trajectories.id, traj.id))
  } catch {
    // Feature extraction is best-effort — don't fail the ingest if it errors.
  }

  // Audit event (Pillar 2)
  await db.insert(events).values({
    type: 'trajectory.ingested',
    workspaceId: opts.workspaceId,
    actorId: opts.actorId ?? null,
    payload: {
      trajectoryId: traj.id,
      source: opts.trajectory.source,
      agentName: opts.trajectory.agentName,
      stepCount: opts.trajectory.steps.length,
      providersInferred,
    },
  })

  return {
    trajectoryId: traj.id,
    stepCount: opts.trajectory.steps.length,
    format: 'canonical', // (post-adapter, by definition)
    providersInferred,
    trajectory: opts.trajectory,
  }
}

/**
 * Build the canonical provider identifier for upsert.
 * Format examples:
 *   function:search_db
 *   mcp:postgres-query/execute
 *   cli:./deploy.sh
 *   skill:invoice-processor
 *   api:stripe/charges.create
 */
function buildProviderIdentifier(
  kind: ToolProviderKind,
  c: {
    toolName: string
    providerHint?: {
      mcpServer?: string
      mcpCapability?: string
      cliCommand?: string
      skillName?: string
      apiOperationId?: string
    }
  },
): string {
  const hint = c.providerHint
  switch (kind) {
    case 'mcp':
      if (hint?.mcpServer && hint?.mcpCapability) {
        return `mcp:${hint.mcpServer}/${hint.mcpCapability}`
      }
      return `mcp:${c.toolName}`
    case 'cli':
      return `cli:${hint?.cliCommand ?? c.toolName}`
    case 'skill':
      return `skill:${hint?.skillName ?? c.toolName}`
    case 'api':
      return `api:${hint?.apiOperationId ?? c.toolName}`
    case 'function':
    default:
      return `function:${c.toolName}`
  }
}

/**
 * One-shot ingest entry point — typically called from Route Handlers and the
 * Eval-Run engine. Does detect → adapt → persist in sequence.
 */
export async function ingestTrajectory(
  input: IngestInput,
): Promise<IngestResult> {
  const { trajectory, format } = adaptToCanonical({
    payload: input.payload,
    format: input.format,
    agentName: input.agentName,
    source: input.source,
  })

  const result = await persistTrajectory({
    workspaceId: input.workspaceId,
    taskId: input.taskId ?? null,
    trajectory,
    actorId: input.actorId ?? null,
  })

  return {
    trajectoryId: result.trajectoryId,
    stepCount: result.stepCount,
    format,
    providersInferred: result.providersInferred,
  }
}
