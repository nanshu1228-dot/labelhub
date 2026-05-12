import { z } from 'zod'
import { runListTrajectories } from '../../scripts/debug/list-trajectories'
import { jsonResult } from './_format'
import type { ToolModule } from './_types'

const shape = {
  workspaceId: z
    .string()
    .uuid()
    .optional()
    .describe('Filter by workspace. Defaults to the demo workspace.'),
  agentName: z
    .string()
    .optional()
    .describe('Filter by exact agentName, e.g. "doubao/doubao-1-5-pro-32k-250115".'),
  source: z
    .enum(['production', 'eval-run', 'synthetic', 'upload'])
    .optional()
    .describe('Filter by trajectory source.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Page size. Default 20, max 200.'),
  includeDeleted: z
    .boolean()
    .optional()
    .describe('Include soft-deleted rows. Default false.'),
}

type Args = {
  workspaceId?: string
  agentName?: string
  source?: 'production' | 'eval-run' | 'synthetic' | 'upload'
  limit?: number
  includeDeleted?: boolean
}

export const listTrajectoriesTool: ToolModule<Args> = {
  name: 'list_trajectories',
  config: {
    title: 'List trajectories',
    description:
      'List captured trajectories (newest first) with step count + final-response preview. Filter by workspace, agent name, or source. Use to verify ingest from any channel (proxy/SDK/eval-run/upload).',
    inputSchema: shape,
  },
  handler: async (args) => jsonResult(await runListTrajectories(args)),
}
