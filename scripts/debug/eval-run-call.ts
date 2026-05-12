/**
 * eval_run_call — programmatic POST to /api/eval-runs, bypassing the UI.
 *
 * Caveat: /api/eval-runs uses USER SESSION auth (requireWorkspaceAdmin), NOT
 * an API key. This tool can't fully bypass that — the route reads the Supabase
 * cookie. So this is a thin convenience: it forwards the cookie you supply
 * (e.g. copied from a logged-in browser session) along with the JSON body.
 *
 * Common use: you're debugging an eval-run regression and want to trigger one
 * over and over with the same inputs while reading server logs. Copy
 * `cookie: ...` from your browser DevTools → pass via --cookie, done.
 *
 * If you want a no-auth path: hit /api/proxy/doubao/chat/completions instead
 * (proxy_call tool) — it exercises the same trajectory ingest pipeline.
 *
 * Run:
 *   tsx scripts/debug/eval-run-call.ts \
 *     --workspace 00000000-0000-0000-0000-000000000010 \
 *     --system "You are a concise math tutor." \
 *     --input "What's 11 squared?" \
 *     --cookie "sb-access-token=...; sb-refresh-token=..."
 */
import { cliRun, isMain, parseArgs } from './_shared/args'
import { DEMO_WORKSPACE_ID } from './_shared/api-key'
import { ensureEnv } from './_shared/db'

export interface EvalRunCallArgs {
  workspaceId?: string
  agentName?: string
  model?: string
  systemPrompt: string
  inputs: string[]
  taskId?: string
  baseUrl?: string
  cookie?: string
}

export interface EvalRunCallResult {
  httpStatus: number
  durationMs: number
  body: unknown
  hint?: string
}

export async function runEvalRunCall(
  args: EvalRunCallArgs,
): Promise<EvalRunCallResult> {
  ensureEnv()
  const baseUrl = (args.baseUrl ?? 'http://localhost:3000').replace(/\/$/, '')

  if (!args.systemPrompt) throw new Error('systemPrompt is required')
  if (!args.inputs || args.inputs.length === 0) {
    throw new Error('inputs must be a non-empty array')
  }

  const payload = {
    workspaceId: args.workspaceId ?? DEMO_WORKSPACE_ID,
    agentName: args.agentName ?? 'eval-agent',
    agent: {
      model: args.model,
      systemPrompt: args.systemPrompt,
      tools: [],
    },
    inputs: args.inputs,
    ...(args.taskId ? { taskId: args.taskId } : {}),
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (args.cookie) headers.cookie = args.cookie

  const start = Date.now()
  let httpStatus = 0
  let body: unknown = null
  try {
    const res = await fetch(`${baseUrl}/api/eval-runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    httpStatus = res.status
    const text = await res.text()
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    body = { error: msg }
  }
  const durationMs = Date.now() - start

  const result: EvalRunCallResult = { httpStatus, durationMs, body }
  if (httpStatus === 401 && !args.cookie) {
    result.hint =
      'Got 401 — this endpoint requires a Supabase user session. Pass --cookie with your browser cookie header, or use proxy_call instead.'
  }
  return result
}

if (isMain(import.meta.url)) {
  void cliRun(async () => {
    const a = parseArgs(process.argv.slice(2))
    if (!a.system) throw new Error('Missing --system (system prompt).')
    if (!a.input) throw new Error('Missing --input (user message).')
    return runEvalRunCall({
      workspaceId: a.workspace ? String(a.workspace) : undefined,
      agentName: a.agent ? String(a.agent) : undefined,
      model: a.model ? String(a.model) : undefined,
      systemPrompt: String(a.system),
      inputs: [String(a.input)],
      taskId: a.task ? String(a.task) : undefined,
      baseUrl: a.base ? String(a.base) : undefined,
      cookie: a.cookie ? String(a.cookie) : undefined,
    })
  })
}
