/**
 * System-prompt scope injection — pure functions used by the proxy route.
 *
 * Given an incoming request body (already JSON-parsed) and a topic-scope
 * suffix, produce a mutated body where the suffix has been prepended to the
 * upstream system prompt — framed as platform policy that the publisher's
 * own system prompt is layered on top of.
 *
 * Two families, two shapes:
 *
 *   openai-compat:  body.messages = [{ role: 'system'|'user'|... , content }]
 *                   System prompt lives in messages[0] when present.
 *                   We unshift (or merge into) a system message.
 *
 *   anthropic:      body.system   = string | TextBlock[]    (top-level)
 *                   body.messages = [{ role: 'user'|'assistant', content }]
 *                   We prepend to `system` (or set it if absent). Anthropic
 *                   does NOT support 'system' in messages[].
 *
 * Both functions are total: invalid input shapes return the body unchanged.
 * The proxy already validates `messages` exists upstream of this call.
 *
 * Why prepend (not append) — the publisher's prompt comes AFTER the platform
 * policy. The model treats the latest instruction as highest priority on
 * conflicts, so leaving the platform policy at the END would let a malicious
 * publisher override it. Prepending puts platform first; the publisher's
 * persona instructions ("you are a friendly translator") run AFTER and add
 * detail on top of the locked scope.
 *
 * Pure / no IO / safe to unit-test.
 */

const POLICY_HEADER_OPEN = '[LabelHub platform policy — non-negotiable]'
const POLICY_HEADER_CLOSE = '[End platform policy]'

export interface InjectionResult {
  body: Record<string, unknown>
  /** True when we actually changed the body. */
  injected: boolean
  /** Diagnostic label for logs — which path we took. */
  via:
    | 'openai-prepend'
    | 'openai-merge-existing-system'
    | 'anthropic-prepend-string'
    | 'anthropic-prepend-blocks'
    | 'anthropic-set-system'
    | 'skipped-invalid-body'
    | 'skipped-empty-suffix'
}

/**
 * Build the wrapping policy block. The publisher's own system prompt (if any)
 * is concatenated AFTER this block, separated by a blank line, so the model
 * sees:
 *
 *   [LabelHub platform policy — non-negotiable]
 *   <suffix>
 *   [End platform policy]
 *
 *   <publisher system prompt>
 */
function wrapSuffix(suffix: string): string {
  return `${POLICY_HEADER_OPEN}\n${suffix.trim()}\n${POLICY_HEADER_CLOSE}`
}

// ─── OpenAI-compatible (Doubao / DeepSeek / Qwen / Moonshot / OpenAI) ───

export function injectOpenAIScope(
  body: Record<string, unknown>,
  suffix: string,
): InjectionResult {
  if (!suffix || !suffix.trim()) {
    return { body, injected: false, via: 'skipped-empty-suffix' }
  }
  const messages = body.messages
  if (!Array.isArray(messages) || messages.length === 0) {
    return { body, injected: false, via: 'skipped-invalid-body' }
  }

  const first = messages[0] as { role?: unknown; content?: unknown } | undefined
  const wrap = wrapSuffix(suffix)

  // If the publisher's first message is already a system message, merge:
  // platform policy first, then their content. Their content stays intact.
  if (first && first.role === 'system') {
    const existingContent =
      typeof first.content === 'string' ? first.content : ''
    const newMessages = [
      {
        role: 'system' as const,
        content: existingContent
          ? `${wrap}\n\n${existingContent}`
          : wrap,
      },
      ...messages.slice(1),
    ]
    return {
      body: { ...body, messages: newMessages },
      injected: true,
      via: 'openai-merge-existing-system',
    }
  }

  // Otherwise unshift a brand-new system message.
  const newMessages = [
    { role: 'system' as const, content: wrap },
    ...messages,
  ]
  return {
    body: { ...body, messages: newMessages },
    injected: true,
    via: 'openai-prepend',
  }
}

// ─── Anthropic ──────────────────────────────────────────────────────────

interface AnthropicTextBlock {
  type: 'text'
  text: string
  cache_control?: unknown
}

export function injectAnthropicScope(
  body: Record<string, unknown>,
  suffix: string,
): InjectionResult {
  if (!suffix || !suffix.trim()) {
    return { body, injected: false, via: 'skipped-empty-suffix' }
  }
  // Anthropic doesn't validate via messages array shape here — the proxy
  // already did. We only mutate the `system` field.
  const wrap = wrapSuffix(suffix)
  const sys = body.system

  // 1. No system field → set it.
  if (sys === undefined || sys === null) {
    return {
      body: { ...body, system: wrap },
      injected: true,
      via: 'anthropic-set-system',
    }
  }

  // 2. Plain string system → concatenate with the policy first.
  if (typeof sys === 'string') {
    return {
      body: {
        ...body,
        system: sys ? `${wrap}\n\n${sys}` : wrap,
      },
      injected: true,
      via: 'anthropic-prepend-string',
    }
  }

  // 3. TextBlock array (with optional prompt caching).
  if (Array.isArray(sys)) {
    const policyBlock: AnthropicTextBlock = { type: 'text', text: wrap }
    const newSystem = [policyBlock, ...sys]
    return {
      body: { ...body, system: newSystem },
      injected: true,
      via: 'anthropic-prepend-blocks',
    }
  }

  // Unknown shape — leave alone.
  return { body, injected: false, via: 'skipped-invalid-body' }
}

// ─── Dispatcher ─────────────────────────────────────────────────────────

export function injectScopeForFamily(
  family: 'openai-compat' | 'anthropic',
  body: Record<string, unknown>,
  suffix: string,
): InjectionResult {
  if (family === 'anthropic') return injectAnthropicScope(body, suffix)
  return injectOpenAIScope(body, suffix)
}
