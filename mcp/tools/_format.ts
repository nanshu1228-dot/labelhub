/**
 * Format a tool result for MCP transport.
 *
 * MCP tools return `{ content: [{ type: 'text', text: '...' }] }`. Most of our
 * tools want to ship a structured JSON object — we serialize it as pretty
 * text so the calling LLM can read it directly.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  }
}

export function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  }
}
