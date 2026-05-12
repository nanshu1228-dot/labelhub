/**
 * LabelHub project-MCP server (stdio transport).
 *
 * Boots via `npm run mcp`. Registered for Claude Code auto-discovery through
 * `.mcp.json` at the project root.
 *
 * Tool surface (capped at 7 by design):
 *   - dev_health         — env + DB + dev-server checks
 *   - proxy_call         — verify Doubao proxy capture loop
 *   - list_trajectories  — recent rows with step counts
 *   - get_trajectory     — full row + ordered steps + provider names
 *   - tail_audit_log     — last N api_request_log entries
 *   - reset_demo         — drop captured trajectories from demo workspace
 *   - eval_run_call      — programmatic POST /api/eval-runs
 *
 * Each tool's logic lives in scripts/debug/<name>.ts so the same code is
 * reachable as a bare `tsx scripts/debug/<name>.ts ...` CLI invocation — see
 * mcp/README.md for the underlying script docs.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { devHealthTool } from './tools/dev-health'
import { proxyCallTool } from './tools/proxy-call'
import { listTrajectoriesTool } from './tools/list-trajectories'
import { getTrajectoryTool } from './tools/get-trajectory'
import { tailAuditLogTool } from './tools/tail-audit-log'
import { resetDemoTool } from './tools/reset-demo'
import { evalRunCallTool } from './tools/eval-run-call'

async function main() {
  const server = new McpServer({
    name: 'labelhub-debug',
    version: '0.1.0',
  })

  // The handlers in each ToolModule are typed against their own Args shape;
  // the registry pattern flattens them so we register uniformly. We cast the
  // handler at the registration boundary — every individual tool file remains
  // fully type-safe.
  const tools = [
    devHealthTool,
    proxyCallTool,
    listTrajectoriesTool,
    getTrajectoryTool,
    tailAuditLogTool,
    resetDemoTool,
    evalRunCallTool,
  ]
  for (const t of tools) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.registerTool(t.name, t.config, t.handler as any)
  }

  // Everything goes through stdout — keep server status messages on stderr so
  // they don't corrupt the JSON-RPC frames Claude Code consumes.
  process.stderr.write(
    `[labelhub-mcp] ready (${tools.length} tools registered)\n`,
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[labelhub-mcp] fatal:', e instanceof Error ? e.stack ?? e.message : e)
  process.exit(1)
})
