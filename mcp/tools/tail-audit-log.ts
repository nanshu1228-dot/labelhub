import { z } from 'zod'
import { runTailAuditLog } from '../../scripts/debug/tail-audit-log'
import { jsonResult } from './_format'
import type { ToolModule } from './_types'

const shape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('Number of rows to return, newest first. Default 50, max 500.'),
  workspaceId: z
    .string()
    .uuid()
    .optional()
    .describe('Restrict to one workspace.'),
  endpoint: z
    .string()
    .optional()
    .describe(
      'Exact endpoint string, e.g. "POST /api/proxy/doubao/chat/completions".',
    ),
  failuresOnly: z
    .boolean()
    .optional()
    .describe('When true, return only rows with status >= 400.'),
}

type Args = {
  limit?: number
  workspaceId?: string
  endpoint?: string
  failuresOnly?: boolean
}

export const tailAuditLogTool: ToolModule<Args> = {
  name: 'tail_audit_log',
  config: {
    title: 'Tail api_request_log',
    description:
      'Read the most recent entries from api_request_log: endpoint, method, status, error_code, duration_ms, timestamp. Combine with --failures-only when chasing why a request 4xx-ed.',
    inputSchema: shape,
  },
  handler: async (args) => jsonResult(await runTailAuditLog(args)),
}
