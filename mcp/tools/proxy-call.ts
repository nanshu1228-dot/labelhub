import { z } from 'zod'
import { runProxyCall } from '../../scripts/debug/proxy-call'
import { jsonResult } from './_format'
import type { ToolModule } from './_types'

const shape = {
  prompt: z
    .string()
    .min(1)
    .describe(
      'User message to send through the Doubao proxy. The proxy will forward it to ARK and capture the full trajectory.',
    ),
  model: z
    .string()
    .optional()
    .describe(
      'Doubao model id. Defaults to env DOUBAO_DEFAULT_MODEL or "doubao-1-5-pro-32k-250115".',
    ),
  systemPrompt: z
    .string()
    .optional()
    .describe('Optional system message prepended before the user prompt.'),
  baseUrl: z
    .string()
    .optional()
    .describe('Override the Next.js base URL. Defaults to http://localhost:3000.'),
}

type Args = { prompt: string; model?: string; systemPrompt?: string; baseUrl?: string }

export const proxyCallTool: ToolModule<Args> = {
  name: 'proxy_call',
  config: {
    title: 'Doubao proxy call + trajectory check',
    description:
      'Exercise POST /api/proxy/doubao/chat/completions end-to-end. Mints (or reuses) a demo workspace API key, sends the prompt, and returns BOTH the upstream Doubao response AND the trajectory the proxy captured (step kinds, counts, previews). Use to verify the capture pipeline after schema/proxy changes.',
    inputSchema: shape,
  },
  handler: async (args) =>
    jsonResult(
      await runProxyCall({
        prompt: args.prompt,
        model: args.model,
        systemPrompt: args.systemPrompt,
        baseUrl: args.baseUrl,
      }),
    ),
}
