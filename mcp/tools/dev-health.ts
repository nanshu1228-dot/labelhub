import { runDevHealth } from '../../scripts/debug/dev-health'
import { jsonResult } from './_format'
import type { ToolModule } from './_types'

export const devHealthTool: ToolModule<Record<string, never>> = {
  name: 'dev_health',
  config: {
    title: 'Dev health check',
    description:
      'Probe local dev environment: required env vars, Postgres connectivity, demo workspace seed status, and whether the Next.js dev server is listening on :3000. Use this first when a tool call unexpectedly fails — it surfaces config issues at the source.',
    inputSchema: {},
  },
  handler: async () => jsonResult(await runDevHealth()),
}
