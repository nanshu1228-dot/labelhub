/**
 * @labelhub/trace — minimal client SDK.
 *
 * Zero-dependency. Drop into any Node / Bun / Deno project. ~120 lines total.
 *
 * Usage:
 *   import { trace } from '@labelhub/trace'  // (or copy this file into your app)
 *   const t = trace({ apiKey: process.env.LABELHUB_KEY!, agentName: 'travel-bot' })
 *   t.start({ rootPrompt: userQuery })
 *   t.step({ kind: 'thinking', content: { text: '…' } })
 *   t.step({ kind: 'tool_call', content: { toolCallId: 'c1', toolName: 'search', args: {…} } })
 *   t.step({ kind: 'tool_result', content: { toolCallId: 'c1', output: {…} } })
 *   t.step({ kind: 'final_response', content: { text: '…' } })
 *   await t.flush()
 */

export type Lh_Kind =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'sub_agent_call'
  | 'sub_agent_response'
  | 'final_response'
  | 'error'

export interface Lh_TraceOpts {
  apiKey: string
  agentName: string
  /** Defaults to https://api.labelhub.com */
  endpoint?: string
  /** Defaults to 'production'. Use 'eval-run' if instrumenting an internal benchmark. */
  source?: 'production' | 'eval-run' | 'synthetic' | 'upload'
}

export interface Lh_StepInput {
  kind: Lh_Kind
  content: unknown
  ts?: Date
  modelName?: string
  latencyMs?: number
  tokensIn?: number
  tokensOut?: number
}

export interface Lh_FlushResult {
  trajectoryId: string
  stepCount: number
}

class LabelHubTrace {
  private steps: Array<Record<string, unknown>> = []
  private rootPrompt = ''
  private finalResponse: string | undefined
  private meta: Record<string, unknown> = {}

  constructor(private opts: Lh_TraceOpts) {
    if (!opts.apiKey || !opts.apiKey.startsWith('lh_ws_')) {
      throw new Error('LabelHub: apiKey must be a workspace key (lh_ws_...).')
    }
  }

  /** Call once at the start of an agent run with the user's prompt. */
  start(input: { rootPrompt: string; meta?: Record<string, unknown> }): this {
    this.rootPrompt = input.rootPrompt
    if (input.meta) this.meta = { ...this.meta, ...input.meta }
    return this
  }

  /** Add a step. Sequence is assigned automatically. */
  step(input: Lh_StepInput): this {
    this.steps.push({
      sequence: this.steps.length,
      kind: input.kind,
      content: input.content,
      ts: input.ts ? input.ts.toISOString() : new Date().toISOString(),
      modelName: input.modelName,
      latencyMs: input.latencyMs,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
    })
    return this
  }

  /** Optional: mark the agent's final user-facing response. */
  end(input: { finalResponse: string }): this {
    this.finalResponse = input.finalResponse
    return this
  }

  /** POST the canonical trajectory to LabelHub. Returns the trajectory ID. */
  async flush(): Promise<Lh_FlushResult> {
    const endpoint =
      (this.opts.endpoint ?? 'https://api.labelhub.com').replace(/\/$/, '') +
      '/api/ingest/trajectories'

    const trajectory = {
      agentName: this.opts.agentName,
      rootPrompt: this.rootPrompt,
      finalResponse: this.finalResponse,
      source: this.opts.source ?? 'production',
      schemaVersion: '1.0',
      steps: this.steps,
      meta: this.meta,
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.apiKey}`,
        'x-labelhub-agent-name': this.opts.agentName,
        'x-labelhub-source': trajectory.source,
        'x-labelhub-format': 'canonical',
      },
      body: JSON.stringify(trajectory),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(
        `LabelHub ingest failed: ${response.status} ${response.statusText} ${errText}`,
      )
    }

    const result = (await response.json()) as {
      trajectoryId: string
      stepCount: number
    }

    // Reset internal state — caller can reuse this instance for next run.
    this.steps = []
    this.rootPrompt = ''
    this.finalResponse = undefined
    this.meta = {}

    return { trajectoryId: result.trajectoryId, stepCount: result.stepCount }
  }
}

export function trace(opts: Lh_TraceOpts): LabelHubTrace {
  return new LabelHubTrace(opts)
}

export type { LabelHubTrace }
