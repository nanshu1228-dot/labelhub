/**
 * Format detection for incoming trajectory payloads.
 *
 * Cheap, structural — looks at first-level fields only. Callers can override
 * via the `X-LabelHub-Format` header (handled at the Route Handler level).
 */

export type DetectedFormat =
  | 'canonical'
  | 'anthropic'
  | 'openai-assistants'
  | 'unknown'

export function detectFormat(raw: unknown): DetectedFormat {
  if (typeof raw !== 'object' || raw === null) return 'unknown'
  const obj = raw as Record<string, unknown>

  // Canonical: has our schemaVersion + steps array + agentName.
  if (
    'schemaVersion' in obj &&
    typeof obj.schemaVersion === 'string' &&
    Array.isArray(obj.steps) &&
    'agentName' in obj
  ) {
    return 'canonical'
  }

  // Anthropic Messages: messages[] where content blocks include tool_use / tool_result.
  if (Array.isArray(obj.messages)) {
    const msgs = obj.messages as Array<Record<string, unknown>>
    const hasToolBlock = msgs.some((m) => {
      if (!Array.isArray(m.content)) return false
      return (m.content as Array<Record<string, unknown>>).some(
        (b) => b.type === 'tool_use' || b.type === 'tool_result',
      )
    })
    if (hasToolBlock) return 'anthropic'
    // Even without tool blocks, if messages array is present + role/content shape, treat as Anthropic
    if (
      msgs.length > 0 &&
      msgs.every((m) => typeof m.role === 'string' && 'content' in m)
    ) {
      return 'anthropic'
    }
  }

  // OpenAI Assistants: run_steps array, or object === 'thread.run'.
  if (obj.object === 'thread.run') return 'openai-assistants'
  if (Array.isArray(obj.run_steps)) return 'openai-assistants'

  return 'unknown'
}
