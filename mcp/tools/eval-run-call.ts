import { z } from 'zod'
import { runEvalRunCall } from '../../scripts/debug/eval-run-call'
import { jsonResult } from './_format'
import type { ToolModule } from './_types'

const shape = {
  systemPrompt: z
    .string()
    .min(1)
    .describe("Agent system prompt — defines tone, persona, tool-use policy."),
  input: z
    .string()
    .min(1)
    .describe('User message that drives the eval run.'),
  workspaceId: z
    .string()
    .uuid()
    .optional()
    .describe('Defaults to the demo workspace.'),
  agentName: z.string().optional().describe('Defaults to "eval-agent".'),
  model: z
    .string()
    .optional()
    .describe('Anthropic model id; omit to use the API default.'),
  taskId: z.string().uuid().optional().describe('Link the captured trajectories to a task.'),
  baseUrl: z.string().optional(),
  cookie: z
    .string()
    .optional()
    .describe(
      'Supabase auth cookie to forward. /api/eval-runs requires a user session — copy from a logged-in browser.',
    ),
}

type Args = {
  systemPrompt: string
  input: string
  workspaceId?: string
  agentName?: string
  model?: string
  taskId?: string
  baseUrl?: string
  cookie?: string
}

export const evalRunCallTool: ToolModule<Args> = {
  name: 'eval_run_call',
  config: {
    title: 'Trigger an eval run',
    description:
      'POST /api/eval-runs without using the UI. NOTE: this endpoint uses Supabase user-session auth (not API key) — pass a browser cookie via the cookie field, or use proxy_call to exercise the same ingest pipeline without auth.',
    inputSchema: shape,
  },
  handler: async (args) =>
    jsonResult(
      await runEvalRunCall({
        systemPrompt: args.systemPrompt,
        inputs: [args.input],
        workspaceId: args.workspaceId,
        agentName: args.agentName,
        model: args.model,
        taskId: args.taskId,
        baseUrl: args.baseUrl,
        cookie: args.cookie,
      }),
    ),
}
