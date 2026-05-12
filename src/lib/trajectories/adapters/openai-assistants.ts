import {
  validateTrajectory,
  type CanonicalStep,
  type CanonicalTrajectory,
  type TrajectorySource,
} from '../schema'

/**
 * OpenAI Assistants API adapter — MVP slice.
 *
 * Handles the `run_steps` list shape:
 *   {
 *     thread_id, run_id, assistant_id, model?,
 *     initial_user_message: string,
 *     run_steps: [
 *       { type: 'message_creation', step_details: { message_creation: { content: ... } } }
 *       { type: 'tool_calls', step_details: { tool_calls: [{ id, function: { name, arguments }, output? }] } }
 *     ]
 *   }
 *
 * NOTE: real OpenAI Assistants is more complex (run states, file search, code interpreter
 * sub-types). This adapter handles function-call type tools only. Other types ingest as
 * generic `thinking` steps with sourceFormat tag for downstream debugging.
 */

interface OpenAIRunStep {
  type?: string
  step_details?: {
    message_creation?: {
      content?: unknown
    }
    tool_calls?: Array<{
      id?: string
      type?: string
      function?: { name?: string; arguments?: string; output?: unknown }
    }>
  }
}

interface OpenAIInput {
  model?: string
  initial_user_message?: string
  run_steps?: OpenAIRunStep[]
  [key: string]: unknown
}

function safeJsonParse(s: unknown): unknown {
  if (typeof s !== 'string') return s
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c
        if (typeof c === 'object' && c !== null) {
          const obj = c as { text?: { value?: string }; value?: string }
          if (typeof obj.text?.value === 'string') return obj.text.value
          if (typeof obj.value === 'string') return obj.value
        }
        return ''
      })
      .join('\n')
  }
  return ''
}

export function adaptOpenAIAssistants(
  rawInput: unknown,
  opts: { agentName: string; source: TrajectorySource },
): CanonicalTrajectory {
  if (typeof rawInput !== 'object' || rawInput === null) {
    throw new Error('OpenAI Assistants adapter: input must be an object')
  }
  const input = rawInput as OpenAIInput
  const runSteps = Array.isArray(input.run_steps) ? input.run_steps : []

  const rootPrompt =
    (typeof input.initial_user_message === 'string' && input.initial_user_message) ||
    '(empty)'

  const steps: CanonicalStep[] = []
  let seq = 0

  for (const rs of runSteps) {
    const details = rs.step_details ?? {}
    if (rs.type === 'message_creation' && details.message_creation) {
      const text = extractMessageText(details.message_creation.content)
      if (text) {
        steps.push({
          sequence: seq++,
          kind: 'thinking',
          content: { text },
          modelName: input.model,
        })
      }
      continue
    }

    if (rs.type === 'tool_calls' && Array.isArray(details.tool_calls)) {
      for (const tc of details.tool_calls) {
        if (tc.type === 'function' && tc.function) {
          const toolCallId = String(tc.id ?? `call_${seq}`)
          steps.push({
            sequence: seq++,
            kind: 'tool_call',
            content: {
              toolCallId,
              toolName: String(tc.function.name ?? 'unknown'),
              args: safeJsonParse(tc.function.arguments),
              providerKind: 'function',
            },
            modelName: input.model,
          })
          if (tc.function.output !== undefined) {
            steps.push({
              sequence: seq++,
              kind: 'tool_result',
              content: {
                toolCallId,
                output: safeJsonParse(tc.function.output),
              },
              modelName: input.model,
            })
          }
        } else {
          // Non-function tool types (file_search, code_interpreter, etc.) — log as thinking with the raw payload.
          steps.push({
            sequence: seq++,
            kind: 'thinking',
            content: { text: `[unsupported tool type: ${tc.type}]` },
            modelName: input.model,
          })
        }
      }
    }
  }

  if (steps.length > 0) {
    const last = steps[steps.length - 1]
    if (last.kind === 'thinking') {
      last.kind = 'final_response'
    }
  }

  const finalResponseStep = steps.find((s) => s.kind === 'final_response')
  const finalResponse =
    finalResponseStep && typeof (finalResponseStep.content as { text?: unknown }).text === 'string'
      ? ((finalResponseStep.content as { text: string }).text).slice(0, 200_000)
      : undefined

  return validateTrajectory({
    agentName: opts.agentName,
    rootPrompt,
    finalResponse,
    source: opts.source,
    schemaVersion: '1.0',
    steps,
    meta: { sourceFormat: 'openai-assistants' },
  })
}
