/**
 * OpenAI / Doubao streaming-delta accumulator.
 *
 * Watches the SSE event stream from a Chat Completions endpoint with
 * `stream: true`, and folds the per-delta chunks back into the same
 * `OpenAIChatResponse` shape the non-streaming adapter consumes. The proxy
 * pipes raw bytes to the client unchanged AND feeds parsed events into us
 * for later persistence.
 *
 * Delta shapes we accumulate:
 *   - choices[0].delta.role          → set message.role once
 *   - choices[0].delta.content       → append to message.content
 *   - choices[0].delta.reasoning_content
 *                                    → append (Doubao R-line CoT)
 *   - choices[0].delta.tool_calls[i] → indexed; .function.name first frame,
 *                                      .function.arguments concatenated
 *   - choices[0].finish_reason       → captured on the last delta
 *   - usage                          → captured if upstream emits it
 *                                      (OpenAI requires stream_options.include_usage)
 *
 * Sentinel: `data: [DONE]` (literal, not JSON) — ignored, just terminates the stream.
 *
 * Invalid JSON per-chunk is logged + skipped, never crashes accumulation.
 */

import type {
  OpenAIChatResponse,
  OpenAIToolCall,
} from './openai-compat-adapter'

interface ChoiceDelta {
  index?: number
  delta?: {
    role?: string
    content?: string | null
    reasoning_content?: string | null
    tool_calls?: Array<{
      index: number
      id?: string
      type?: 'function'
      function?: {
        name?: string
        arguments?: string
      }
    }>
  }
  finish_reason?: string | null
}

interface ChunkPayload {
  id?: string
  model?: string
  created?: number
  choices?: ChoiceDelta[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export class OpenAIStreamAccumulator {
  private id?: string
  private model?: string
  private created?: number
  private role: 'assistant' = 'assistant'
  private contentParts: string[] = []
  private reasoningParts: string[] = []
  /** Tool call slots keyed by `delta.tool_calls[].index`. */
  private toolCalls: Map<number, OpenAIToolCall & { _argsParts: string[] }> =
    new Map()
  private finishReason: string | null = null
  private usage: ChunkPayload['usage'] = undefined
  private chunkCount = 0

  /** Feed one SSE event payload. Returns true if processed, false if ignored. */
  feed(data: string): boolean {
    const trimmed = data.trim()
    if (trimmed === '' || trimmed === '[DONE]') return false
    let chunk: ChunkPayload
    try {
      chunk = JSON.parse(trimmed) as ChunkPayload
    } catch {
      return false
    }
    this.chunkCount++

    if (chunk.id) this.id = chunk.id
    if (chunk.model) this.model = chunk.model
    if (chunk.created) this.created = chunk.created
    if (chunk.usage) this.usage = chunk.usage

    const choice = chunk.choices?.[0]
    if (!choice) return true
    const delta = choice.delta

    if (delta) {
      if (typeof delta.role === 'string') this.role = 'assistant'
      if (typeof delta.content === 'string') this.contentParts.push(delta.content)
      if (typeof delta.reasoning_content === 'string') {
        this.reasoningParts.push(delta.reasoning_content)
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          let slot = this.toolCalls.get(tc.index)
          if (!slot) {
            slot = {
              id: tc.id ?? '',
              type: 'function',
              function: { name: '', arguments: '' },
              _argsParts: [],
            }
            this.toolCalls.set(tc.index, slot)
          }
          if (tc.id) slot.id = tc.id
          if (tc.function?.name) slot.function.name = tc.function.name
          if (typeof tc.function?.arguments === 'string') {
            slot._argsParts.push(tc.function.arguments)
          }
        }
      }
    }

    if (typeof choice.finish_reason === 'string') {
      this.finishReason = choice.finish_reason
    }

    return true
  }

  /** Did the stream actually emit any usable chunk? */
  get sawAnyChunk(): boolean {
    return this.chunkCount > 0
  }

  /** Number of recognized chunks (for telemetry / debug). */
  get chunks(): number {
    return this.chunkCount
  }

  /**
   * Finalize the accumulator into the same response shape the non-stream
   * adapter consumes. Safe to call exactly once at end-of-stream.
   */
  toFinalResponse(): OpenAIChatResponse {
    const toolCalls: OpenAIToolCall[] = []
    // Re-emit tool calls in the order their `index` appeared.
    const indices = Array.from(this.toolCalls.keys()).sort((a, b) => a - b)
    for (const i of indices) {
      const slot = this.toolCalls.get(i)!
      toolCalls.push({
        id: slot.id || `call_idx_${i}`,
        type: 'function',
        function: {
          name: slot.function.name,
          arguments: slot._argsParts.join(''),
        },
      })
    }
    const content = this.contentParts.join('')
    const reasoning = this.reasoningParts.join('')
    return {
      id: this.id,
      model: this.model,
      created: this.created,
      choices: [
        {
          index: 0,
          message: {
            role: this.role,
            content: content === '' ? null : content,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            ...(reasoning !== ''
              ? { reasoning_content: reasoning }
              : {}),
          },
          finish_reason: this.finishReason,
        },
      ],
      usage: this.usage,
    }
  }
}
