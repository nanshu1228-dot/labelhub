import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ZodRawShape } from 'zod'

/**
 * One MCP tool, in a shape `mcp/server.ts` can register uniformly.
 *
 * `name` is the wire identifier the LLM uses to invoke it. The `config` block
 * matches what `McpServer.registerTool` expects (title shown in clients,
 * description seen by the LLM, inputSchema validated automatically).
 */
export interface ToolModule<Args extends Record<string, unknown>> {
  name: string
  config: {
    title: string
    description: string
    inputSchema: ZodRawShape
  }
  handler: (args: Args) => Promise<CallToolResult>
}
