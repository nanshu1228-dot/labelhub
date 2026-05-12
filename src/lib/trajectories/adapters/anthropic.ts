import {
  validateTrajectory,
  type CanonicalStep,
  type CanonicalTrajectory,
  type TrajectorySource,
} from '../schema'

/**
 * Anthropic Messages API adapter.
 *
 * Input shape (typical Anthropic Messages with tool use):
 *   {
 *     model?: string,
 *     system?: string,
 *     messages: [
 *       { role: 'user', content: string | Block[] },
 *       { role: 'assistant', content: Block[] },   // mixed text + tool_use
 *       { role: 'user', content: Block[] },        // tool_result blocks live here
 *       ...
 *     ]
 *   }
 *
 * Output: canonical TrajectorySchema with steps in order.
 *
 * Mapping rules:
 *   - First user message text  → rootPrompt
 *   - Assistant text block     → thinking step (last one auto-promoted to final_response)
 *   - Assistant tool_use block → tool_call step (providerKind: 'function' by default)
 *   - User tool_result block   → tool_result step
 *   - System prompt → meta.systemPrompt
 */

type AnthropicMsg = { role: string; content: unknown }

interface AnthropicInput {
  model?: string
  system?: string | Array<{ type: string; text?: string }>
  messages: AnthropicMsg[]
  // Allow arbitrary extra fields (we ignore them gracefully).
  [key: string]: unknown
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        typeof b === 'object' &&
        b !== null &&
        (b as { type?: string }).type === 'text' &&
        typeof (b as { text?: unknown }).text === 'string',
    )
    .map((b) => b.text)
    .join('\n')
}

function flattenSystem(system: AnthropicInput['system']): string | undefined {
  if (!system) return undefined
  if (typeof system === 'string') return system
  return system
    .filter((s): s is { type: string; text: string } => typeof s.text === 'string')
    .map((s) => s.text)
    .join('\n')
}

export function adaptAnthropic(
  rawInput: unknown,
  opts: { agentName: string; source: TrajectorySource },
): CanonicalTrajectory {
  if (typeof rawInput !== 'object' || rawInput === null) {
    throw new Error('Anthropic adapter: input must be an object')
  }
  const input = rawInput as AnthropicInput
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new Error('Anthropic adapter: messages array required')
  }

  // Root prompt = first user message text.
  const firstUser = input.messages.find((m) => m.role === 'user')
  const rootPrompt = extractText(firstUser?.content).slice(0, 50_000) || '(empty)'

  const steps: CanonicalStep[] = []
  let seq = 0

  for (const msg of input.messages) {
    if (!Array.isArray(msg.content) && typeof msg.content !== 'string') continue

    // Tool results arrive on user messages.
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content as Array<Record<string, unknown>>) {
        if (block.type === 'tool_result') {
          steps.push({
            sequence: seq++,
            kind: 'tool_result',
            content: {
              toolCallId: String(block.tool_use_id ?? ''),
              output: block.content,
              isError: block.is_error === true,
            },
            modelName: input.model,
          })
        }
      }
      continue // skip pure-text user echo (covered by rootPrompt)
    }

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content as Array<Record<string, unknown>>) {
        if (block.type === 'text' && typeof block.text === 'string') {
          steps.push({
            sequence: seq++,
            kind: 'thinking',
            content: { text: block.text },
            modelName: input.model,
          })
        } else if (block.type === 'tool_use') {
          steps.push({
            sequence: seq++,
            kind: 'tool_call',
            content: {
              toolCallId: String(block.id ?? `call_${seq}`),
              toolName: String(block.name ?? 'unknown'),
              args: block.input,
              providerKind: 'function',
            },
            modelName: input.model,
          })
        }
      }
    }
  }

  // Promote the last 'thinking' step to 'final_response' if nothing follows.
  if (steps.length > 0) {
    const last = steps[steps.length - 1]
    if (last.kind === 'thinking') {
      last.kind = 'final_response'
      // content shape changes: { text } is already what final_response expects.
    }
  }

  const finalResponseStep = steps.find((s) => s.kind === 'final_response')
  const finalResponse =
    finalResponseStep && typeof (finalResponseStep.content as { text?: unknown }).text === 'string'
      ? ((finalResponseStep.content as { text: string }).text).slice(0, 200_000)
      : undefined

  const trajectory: CanonicalTrajectory = {
    agentName: opts.agentName,
    rootPrompt,
    finalResponse,
    source: opts.source,
    schemaVersion: '1.0',
    steps,
    meta: {
      systemPrompt: flattenSystem(input.system),
      sourceFormat: 'anthropic',
    },
  }

  return validateTrajectory(trajectory)
}
