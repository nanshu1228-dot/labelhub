import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { assertWithinDailyAIQuota, logAICall } from '@/lib/ai/quota'
import { MODELS } from '@/lib/ai/anthropic'
import {
  runSimulatedAgent,
  type AgentToolDef,
} from '@/lib/ai/agent-runtime'
import { persistTrajectory } from '@/lib/trajectories/ingest'
import type { CanonicalTrajectory } from '@/lib/trajectories/schema'
import { AppError } from '@/lib/errors'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'

/**
 * POST /api/eval-runs — the hero endpoint.
 *
 * User session auth (NOT API key) — this is a publisher-initiated UI flow.
 * Audit-logged like every other API endpoint.
 */

/**
 * Multi-turn simulated agent run = Sonnet calls × N + Haiku tool-sim calls × N.
 * Worst case (8 tool turns) is around 90s. We pin 60 to match Hobby limits;
 * cut the agent loop short or bump to Pro/300 if you regularly hit the cap.
 */
export const maxDuration = 60

const toolSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(2000),
  input_schema: z.record(z.string(), z.unknown()),
})

const evalRunSchema = z.object({
  workspaceId: z.string().uuid(),
  agentName: z.string().min(1).max(120).default('eval-agent'),
  agent: z.object({
    model: z.string().optional(),
    systemPrompt: z.string().min(1).max(20_000),
    tools: z.array(toolSchema).max(20).default([]),
  }),
  inputs: z.array(z.string().min(1).max(8000)).min(1).max(10),
  taskId: z.string().uuid().optional(),
})

export async function POST(request: NextRequest) {
  const start = Date.now()
  const { userAgent, remoteAddr } = extractRequestMeta(request)

  let workspaceId: string | null = null
  let userId: string | null = null
  let status = 200
  let errorCode: string | null = null
  let response: NextResponse | undefined
  let payloadBytes = 0

  try {
    const bodyText = await request.text()
    payloadBytes = bodyText.length
    // 3rd security audit #8 — eval-run configs should never exceed 500KB.
    if (payloadBytes > 500_000) {
      throw new AppError(
        'PAYLOAD_TOO_LARGE',
        'Body exceeds 500KB eval-run cap.',
        413,
      )
    }

    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new AppError('BAD_JSON', 'Body is not valid JSON.', 400)
    }

    const parsed = evalRunSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
        400,
      )
    }

    workspaceId = parsed.data.workspaceId

    // Auth + quota
    const { user } = await requireWorkspaceAdmin(parsed.data.workspaceId)
    userId = user.id
    await assertWithinDailyAIQuota(user.id)

    const model = parsed.data.agent.model ?? MODELS.default
    const tools: AgentToolDef[] = parsed.data.agent.tools
    const results: Array<{
      trajectoryId: string
      stepCount: number
      providersInferred: number
      stoppedReason: string
      /** Full canonical trajectory so the UI can render without a follow-up fetch. */
      trajectory: CanonicalTrajectory
      rootPrompt: string
      tokensIn: number
      tokensOut: number
    }> = []

    let totalIn = 0
    let totalOut = 0

    for (const userMessage of parsed.data.inputs) {
      const run = await runSimulatedAgent({
        model,
        systemPrompt: parsed.data.agent.systemPrompt,
        tools,
        userMessage,
        agentName: parsed.data.agentName,
      })

      totalIn += run.totalInputTokens
      totalOut += run.totalOutputTokens

      const persisted = await persistTrajectory({
        workspaceId: parsed.data.workspaceId,
        taskId: parsed.data.taskId ?? null,
        trajectory: run.trajectory,
        actorId: user.id,
      })

      results.push({
        trajectoryId: persisted.trajectoryId,
        stepCount: persisted.stepCount,
        providersInferred: persisted.providersInferred,
        stoppedReason: run.stoppedReason,
        trajectory: run.trajectory,
        rootPrompt: userMessage,
        tokensIn: run.totalInputTokens,
        tokensOut: run.totalOutputTokens,
      })
    }

    await logAICall({
      userId: user.id,
      feature: 'eval-run',
      model,
      inputTokens: totalIn,
      outputTokens: totalOut,
      workspaceId: parsed.data.workspaceId,
    })

    response = NextResponse.json({
      ok: true,
      trajectories: results,
      totalInputTokens: totalIn,
      totalOutputTokens: totalOut,
    })
  } catch (e: unknown) {
    if (e instanceof AppError) {
      status = e.status
      errorCode = e.code
      response = NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status },
      )
    } else {
      status = 500
      errorCode = 'INTERNAL'
      const msg = e instanceof Error ? e.message : 'Unknown error'
      // 3rd security audit: never echo DB/internal error text to clients.
      // Log server-side, surface a generic string in the response.
      console.error('[api] internal error:', msg, e instanceof Error ? e.stack : undefined)
      const safeMsg = 'Internal error'
      response = NextResponse.json(
        { error: safeMsg, code: 'INTERNAL' },
        { status: 500 },
      )
    }
  }

  logApiRequest({
    workspaceId,
    userId,
    endpoint: 'POST /api/eval-runs',
    method: 'POST',
    status,
    errorCode,
    durationMs: Date.now() - start,
    remoteAddr,
    userAgent,
    payloadBytes,
  })

  return response!
}
