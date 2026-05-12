import { z } from 'zod'
import { runResetDemo } from '../../scripts/debug/reset-demo'
import { jsonResult } from './_format'
import type { ToolModule } from './_types'

const shape = {
  wipeAudit: z
    .boolean()
    .optional()
    .describe(
      'Also clear events + api_request_log for the demo workspace. Default false.',
    ),
  dryRun: z
    .boolean()
    .optional()
    .describe('Count rows but make no changes. Default false.'),
}

type Args = { wipeAudit?: boolean; dryRun?: boolean }

export const resetDemoTool: ToolModule<Args> = {
  name: 'reset_demo',
  config: {
    title: 'Reset demo workspace data',
    description:
      'Delete captured trajectories + their steps + inferred tool_providers for the demo workspace (00…010). Preserves workspace, tasks, topics, declared tool_providers, and API keys. Pass dryRun=true to preview counts.',
    inputSchema: shape,
  },
  handler: async (args) => jsonResult(await runResetDemo(args)),
}
