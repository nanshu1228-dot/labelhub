/**
 * Pure display/formatting helpers for the trajectory detail surface.
 *
 * Extracted from the (formerly 1.6k-line) detail page so they're small,
 * co-located, and unit-testable in isolation — no React, no DB, no
 * `server-only`. Used by `components/trajectory/detail/*`.
 */

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function prettyJson(v: unknown): string {
  if (v == null) return '(empty)'
  if (typeof v === 'string') {
    // Strings that look like JSON get pretty-printed.
    const trimmed = v.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2)
      } catch {
        return v
      }
    }
    return v
  }
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/** Does meta have at least one agent-config field worth showing? */
export function hasAgentConfig(meta: Record<string, unknown>): boolean {
  const keys = [
    'temperature',
    'maxTokens',
    'topP',
    'topK',
    'seed',
    'toolChoice',
    'responseFormat',
    'parallelToolCalls',
    'disableParallelToolUse',
    'serviceTier',
  ]
  return keys.some((k) => meta[k] != null && meta[k] !== '')
}

export function pickNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function pickBool(v: unknown): string | null {
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return null
}

/**
 * tool_choice can be:
 *   'auto' | 'none' | 'required' | 'any'           (string)
 *   { type: 'function', function: { name } }       (OpenAI)
 *   { type: 'tool', name }                          (Anthropic)
 * Render a compact label.
 */
export function summarizeToolChoice(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    const fn = obj.function as { name?: string } | undefined
    const name = (typeof obj.name === 'string' && obj.name) || fn?.name
    if (name) return `force: ${name}`
    if (typeof obj.type === 'string') return obj.type
  }
  return JSON.stringify(v).slice(0, 50)
}

/** { type: 'json_object' } / { type: 'json_schema', json_schema: {...} } */
export function summarizeResponseFormat(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    if (typeof obj.type === 'string') {
      const schema = obj.json_schema as { name?: string } | undefined
      if (obj.type === 'json_schema' && schema?.name)
        return `json_schema:${schema.name}`
      return obj.type
    }
  }
  return JSON.stringify(v).slice(0, 50)
}
