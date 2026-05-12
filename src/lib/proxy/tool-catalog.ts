/**
 * Tool-catalog extraction.
 *
 * Both OpenAI and Anthropic let the client declare a list of tools the model
 * may call. The model picks one (or none); we already capture the chosen
 * tool_calls. What we WEREN'T capturing was the list of tools the model COULD
 * have chosen but didn't — and that's essential annotation context:
 *
 *   "Why didn't it call search_db?"  is only meaningful if you know
 *   search_db was offered.
 *
 * This module normalizes the two wire formats into one shape so the UI can
 * render them uniformly.
 *
 * OpenAI shape:
 *   tools: [
 *     { type: 'function', function: { name, description?, parameters? } }
 *   ]
 *
 * Anthropic shape:
 *   tools: [
 *     { name, description?, input_schema?, type? }  // type='custom' by default
 *   ]
 */

export interface ToolCatalogEntry {
  /** Provider tool kind — function | custom | computer_use | bash | text_editor */
  kind: string
  name: string
  description?: string
  /** JSON Schema describing the args; opaque structure preserved as-is. */
  parameters?: unknown
}

/**
 * Extract tool catalog from an OpenAI-style request.tools array.
 * Returns [] when no tools were declared, or the input is malformed.
 */
export function extractToolCatalog(
  raw: unknown,
  provider: 'openai' | 'anthropic',
): ToolCatalogEntry[] {
  if (!Array.isArray(raw)) return []
  const out: ToolCatalogEntry[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    const obj = t as Record<string, unknown>

    if (provider === 'openai') {
      // Standard OpenAI: { type: 'function', function: { name, description, parameters } }
      const fn =
        (obj.function as Record<string, unknown> | undefined) ?? undefined
      if (typeof obj.type === 'string' && obj.type === 'function' && fn) {
        const name = typeof fn.name === 'string' ? fn.name : ''
        if (!name) continue
        out.push({
          kind: 'function',
          name,
          description:
            typeof fn.description === 'string' ? fn.description : undefined,
          parameters: fn.parameters,
        })
      }
      // Possible future: type='code_interpreter' / 'retrieval' / 'web_search'
      // — preserve them as kind=<type>, name=<type>.
      else if (typeof obj.type === 'string' && obj.type !== 'function') {
        out.push({ kind: obj.type, name: obj.type })
      }
    } else {
      // Anthropic: { name, description?, input_schema?, type? }
      // type is optional; default 'custom'. computer_use / bash / text_editor
      // have well-known names.
      const name = typeof obj.name === 'string' ? obj.name : ''
      if (!name) continue
      const kind =
        typeof obj.type === 'string' && obj.type.length > 0
          ? obj.type
          : 'custom'
      out.push({
        kind,
        name,
        description:
          typeof obj.description === 'string' ? obj.description : undefined,
        parameters: obj.input_schema,
      })
    }
  }
  return out
}
