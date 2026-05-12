/**
 * proxy_call — exercise the Doubao OpenAI-compat proxy and report what was
 * captured.
 *
 * Flow:
 *   1. Ensure the demo workspace + an API key exist (mint if needed).
 *   2. POST to /api/proxy/doubao/chat/completions with the supplied prompt.
 *   3. Find the trajectory the proxy just captured (race-safe via post-call
 *      "most-recent in workspace within last N seconds" lookup, NOT by parsing
 *      the response which is the raw upstream JSON).
 *   4. Return BOTH the upstream response and a step summary so Claude can
 *      verify the capture loop end-to-end in a single tool call.
 *
 * Run: `tsx scripts/debug/proxy-call.ts --prompt "你是谁？" [--model doubao-1-5-pro-32k-250115] [--base http://localhost:3000]`
 */
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { cliRun, isMain, parseArgs, positionals } from './_shared/args'
import { withDb, type Db, schema } from './_shared/db'
import { DEMO_WORKSPACE_ID, ensureDemoApiKey } from './_shared/api-key'

export interface ProxyCallArgs {
  prompt: string
  model?: string
  systemPrompt?: string
  baseUrl?: string
}

export interface StepSummary {
  sequence: number
  kind: string
  preview: string
  toolCallId: string | null
  toolProviderName: string | null
  latencyMs: number | null
  tokensIn: number | null
  tokensOut: number | null
}

export interface ProxyCallResult {
  httpStatus: number
  durationMs: number
  upstream: unknown
  trajectory: {
    id: string | null
    agentName: string | null
    stepCount: number
    finalResponsePreview: string | null
    stepKinds: Record<string, number>
    steps: StepSummary[]
  }
  warnings: string[]
}

function previewOf(content: unknown, max = 160): string {
  if (content == null) return ''
  if (typeof content === 'string') {
    return content.slice(0, max)
  }
  if (typeof content === 'object') {
    const c = content as Record<string, unknown>
    if (typeof c.text === 'string') return c.text.slice(0, max)
    if (typeof c.toolName === 'string') {
      const args = typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {})
      return `${c.toolName}(${args.slice(0, Math.max(0, max - String(c.toolName).length - 2))})`
    }
    if (typeof c.output === 'string') return c.output.slice(0, max)
    if (c.output != null) return JSON.stringify(c.output).slice(0, max)
    if (typeof c.message === 'string') return c.message.slice(0, max)
  }
  return JSON.stringify(content).slice(0, max)
}

async function captureCutoff(db: Db): Promise<Date> {
  // 1-second buffer so the "before this call started" boundary survives clock skew.
  const [row] = await db.execute<{ now: Date }>(sql`select now() as now`)
  const t = new Date(row.now)
  t.setMilliseconds(t.getMilliseconds() - 1000)
  return t
}

async function findCapturedTrajectory(
  db: Db,
  cutoff: Date,
  agentNameHint: string | null,
) {
  // Prefer the agent-name-matching trajectory created after the cutoff; if the
  // proxy's `doubao/<model>` agentName doesn't match (e.g. upstream changed
  // model field), fall back to the most recent post-cutoff row in the workspace.
  const filters = agentNameHint
    ? and(
        eq(schema.trajectories.workspaceId, DEMO_WORKSPACE_ID),
        eq(schema.trajectories.agentName, agentNameHint),
        gt(schema.trajectories.createdAt, cutoff),
      )
    : and(
        eq(schema.trajectories.workspaceId, DEMO_WORKSPACE_ID),
        gt(schema.trajectories.createdAt, cutoff),
      )

  const [match] = await db
    .select()
    .from(schema.trajectories)
    .where(filters)
    .orderBy(desc(schema.trajectories.createdAt))
    .limit(1)

  if (match) return match

  // Fallback: any post-cutoff row in this workspace.
  if (agentNameHint) {
    const [fallback] = await db
      .select()
      .from(schema.trajectories)
      .where(
        and(
          eq(schema.trajectories.workspaceId, DEMO_WORKSPACE_ID),
          gt(schema.trajectories.createdAt, cutoff),
        ),
      )
      .orderBy(desc(schema.trajectories.createdAt))
      .limit(1)
    return fallback ?? null
  }
  return null
}

export async function runProxyCall(args: ProxyCallArgs): Promise<ProxyCallResult> {
  const baseUrl = (args.baseUrl ?? 'http://localhost:3000').replace(/\/$/, '')
  const model = args.model ?? process.env.DOUBAO_DEFAULT_MODEL ?? 'doubao-1-5-pro-32k-250115'
  const expectedAgentName = `doubao/${model}`

  return withDb(async ({ db }) => {
    const warnings: string[] = []
    const { plain } = await ensureDemoApiKey(db)

    const messages: Array<{ role: string; content: string }> = []
    if (args.systemPrompt) {
      messages.push({ role: 'system', content: args.systemPrompt })
    }
    messages.push({ role: 'user', content: args.prompt })

    const cutoff = await captureCutoff(db)

    const start = Date.now()
    let httpStatus = 0
    let upstreamBody: unknown = null
    try {
      const res = await fetch(`${baseUrl}/api/proxy/doubao/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${plain}`,
        },
        body: JSON.stringify({ model, messages }),
      })
      httpStatus = res.status
      const text = await res.text()
      try {
        upstreamBody = text ? JSON.parse(text) : null
      } catch {
        upstreamBody = text
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      warnings.push(`fetch failed: ${msg}`)
    }
    const durationMs = Date.now() - start

    // Only attempt to find a captured trajectory if the proxy returned 2xx.
    let trajectory: typeof schema.trajectories.$inferSelect | null = null
    if (httpStatus >= 200 && httpStatus < 300) {
      trajectory = await findCapturedTrajectory(db, cutoff, expectedAgentName)
      if (!trajectory) {
        warnings.push(
          'proxy returned 2xx but no trajectory found post-call — capture pipeline may be silently failing',
        )
      }
    } else if (httpStatus !== 0) {
      warnings.push(
        `proxy returned ${httpStatus} — upstream rejected, no capture expected`,
      )
    }

    const stepKinds: Record<string, number> = {}
    const steps: StepSummary[] = []
    if (trajectory) {
      const rows = await db
        .select({
          sequence: schema.trajectorySteps.sequence,
          kind: schema.trajectorySteps.kind,
          content: schema.trajectorySteps.content,
          toolCallId: schema.trajectorySteps.toolCallId,
          latencyMs: schema.trajectorySteps.latencyMs,
          tokensIn: schema.trajectorySteps.tokensIn,
          tokensOut: schema.trajectorySteps.tokensOut,
          providerName: schema.toolProviders.name,
        })
        .from(schema.trajectorySteps)
        .leftJoin(
          schema.toolProviders,
          eq(schema.trajectorySteps.toolProviderId, schema.toolProviders.id),
        )
        .where(eq(schema.trajectorySteps.trajectoryId, trajectory.id))
        .orderBy(schema.trajectorySteps.sequence)

      for (const r of rows) {
        stepKinds[r.kind] = (stepKinds[r.kind] ?? 0) + 1
        steps.push({
          sequence: r.sequence,
          kind: r.kind,
          preview: previewOf(r.content),
          toolCallId: r.toolCallId,
          toolProviderName: r.providerName,
          latencyMs: r.latencyMs,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
        })
      }
    }

    return {
      httpStatus,
      durationMs,
      upstream: upstreamBody,
      trajectory: {
        id: trajectory?.id ?? null,
        agentName: trajectory?.agentName ?? null,
        stepCount: steps.length,
        finalResponsePreview: trajectory?.finalResponse
          ? trajectory.finalResponse.slice(0, 240)
          : null,
        stepKinds,
        steps,
      },
      warnings,
    }
  })
}

if (isMain(import.meta.url)) {
  void cliRun(async () => {
    const a = parseArgs(process.argv.slice(2))
    const prompt = (typeof a.prompt === 'string' ? a.prompt : undefined) ?? positionals(a)[0]
    if (!prompt) {
      throw new Error(
        'Missing --prompt. Example: tsx scripts/debug/proxy-call.ts --prompt "你是谁？"',
      )
    }
    return runProxyCall({
      prompt: String(prompt),
      model: a.model ? String(a.model) : undefined,
      systemPrompt: a.system ? String(a.system) : undefined,
      baseUrl: a.base ? String(a.base) : undefined,
    })
  })
}
