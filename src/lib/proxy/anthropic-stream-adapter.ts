/**
 * Anthropic Messages API streaming-event accumulator.
 *
 * Anthropic's SSE stream is typed via the `event:` header. The full lifecycle:
 *
 *   message_start          → metadata (id, model, initial usage.input_tokens)
 *   content_block_start    → opens block N with a typed shell (text/tool_use/thinking)
 *   content_block_delta    → typed delta (text_delta | input_json_delta | thinking_delta)
 *   content_block_stop     → closes block N
 *   message_delta          → updates stop_reason + usage.output_tokens
 *   message_stop           → end of stream
 *   ping                   → keepalive (ignored)
 *   error                  → upstream-side failure mid-stream
 *
 * Notes:
 *   - tool_use blocks ship JSON in `partial_json` chunks of `input_json_delta`.
 *     We concatenate and JSON.parse at close. Invalid trailing partials are
 *     stored as `{ _raw }` rather than throwing.
 *   - thinking blocks (extended thinking) ship via `thinking_delta`; same
 *     pattern as text.
 *   - We DON'T verify content_block_stop arrived for each open block — some
 *     clients (and abrupt disconnects) skip it. We finalize whatever we have.
 */

import type {
  AnthropicAssistantBlock,
  AnthropicMessagesResponse,
} from './anthropic-messages-adapter'

interface MessageStartPayload {
  type: 'message_start'
  message: {
    id?: string
    model?: string
    role?: 'assistant'
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

interface ContentBlockStartPayload {
  type: 'content_block_start'
  index: number
  content_block:
    | { type: 'text'; text?: string }
    | { type: 'tool_use'; id: string; name: string; input?: unknown }
    | { type: 'thinking'; thinking?: string }
}

interface ContentBlockDeltaPayload {
  type: 'content_block_delta'
  index: number
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'signature_delta'; signature: string } // ignored
}

interface MessageDeltaPayload {
  type: 'message_delta'
  delta?: { stop_reason?: string | null; stop_sequence?: string | null }
  usage?: { output_tokens?: number }
}

interface ContentBlockStop {
  type: 'content_block_stop'
  index: number
}

type AnthropicEventPayload =
  | MessageStartPayload
  | ContentBlockStartPayload
  | ContentBlockDeltaPayload
  | ContentBlockStop
  | MessageDeltaPayload
  | { type: 'message_stop' }
  | { type: 'ping' }
  | { type: 'error'; error?: { type?: string; message?: string } }

interface BlockState {
  kind: 'text' | 'tool_use' | 'thinking'
  /** For text blocks. */
  textParts: string[]
  /** For thinking blocks. */
  thinkingParts: string[]
  /** For tool_use blocks. */
  toolUseId?: string
  toolUseName?: string
  toolUseJsonParts: string[]
}

export class AnthropicStreamAccumulator {
  private id?: string
  private model?: string
  private stopReason: string | null = null
  private stopSequence: string | null = null
  private usage: AnthropicMessagesResponse['usage'] = undefined
  /** Content blocks keyed by their `index` from the stream. */
  private blocks: Map<number, BlockState> = new Map()
  private chunkCount = 0
  private upstreamError: string | null = null

  /**
   * Feed one SSE event. The optional `event` header lets us route fast;
   * we also re-discriminate by `data.type` for resilience.
   */
  feed(event: string | undefined, data: string): boolean {
    const trimmed = data.trim()
    if (trimmed === '') return false
    let payload: AnthropicEventPayload
    try {
      payload = JSON.parse(trimmed) as AnthropicEventPayload
    } catch {
      return false
    }
    this.chunkCount++
    void event // not strictly needed — `payload.type` is the truth

    switch (payload.type) {
      case 'message_start': {
        const m = payload.message ?? {}
        if (m.id) this.id = m.id
        if (m.model) this.model = m.model
        if (m.usage) this.usage = { ...(this.usage ?? {}), ...m.usage }
        break
      }
      case 'content_block_start': {
        const cb = payload.content_block
        const block: BlockState = {
          kind: cb.type,
          textParts: [],
          thinkingParts: [],
          toolUseJsonParts: [],
        }
        if (cb.type === 'text' && typeof cb.text === 'string') {
          if (cb.text) block.textParts.push(cb.text)
        } else if (cb.type === 'thinking' && typeof cb.thinking === 'string') {
          if (cb.thinking) block.thinkingParts.push(cb.thinking)
        } else if (cb.type === 'tool_use') {
          block.toolUseId = cb.id
          block.toolUseName = cb.name
          // Anthropic ships `input: {}` as a placeholder on start when deltas
          // will follow; concatenating that into the parts would corrupt the
          // assembled JSON. Only seed parts if `input` has real keys (rare —
          // it means the whole tool call was emitted atomically on start).
          if (
            cb.input &&
            typeof cb.input === 'object' &&
            Object.keys(cb.input as Record<string, unknown>).length > 0
          ) {
            block.toolUseJsonParts.push(JSON.stringify(cb.input))
          }
        }
        this.blocks.set(payload.index, block)
        break
      }
      case 'content_block_delta': {
        const b = this.blocks.get(payload.index)
        if (!b) break
        const d = payload.delta
        if (d.type === 'text_delta') {
          b.textParts.push(d.text)
        } else if (d.type === 'thinking_delta') {
          b.thinkingParts.push(d.thinking)
        } else if (d.type === 'input_json_delta') {
          b.toolUseJsonParts.push(d.partial_json)
        }
        // signature_delta intentionally ignored — not user-visible
        break
      }
      case 'content_block_stop':
        // No-op for accumulator state; we finalize from current contents.
        break
      case 'message_delta': {
        const d = payload.delta
        if (d?.stop_reason != null) this.stopReason = d.stop_reason
        if (d?.stop_sequence != null) this.stopSequence = d.stop_sequence
        if (payload.usage) {
          this.usage = { ...(this.usage ?? {}), ...payload.usage }
        }
        break
      }
      case 'message_stop':
      case 'ping':
        break
      case 'error':
        this.upstreamError = payload.error?.message ?? 'unknown upstream error'
        break
    }
    return true
  }

  get sawAnyChunk(): boolean {
    return this.chunkCount > 0
  }

  get chunks(): number {
    return this.chunkCount
  }

  get streamError(): string | null {
    return this.upstreamError
  }

  /**
   * Materialize the final `AnthropicMessagesResponse`. Re-emits blocks in
   * the order their `index` appeared.
   */
  toFinalResponse(): AnthropicMessagesResponse {
    const content: AnthropicAssistantBlock[] = []
    const indices = Array.from(this.blocks.keys()).sort((a, b) => a - b)
    for (const i of indices) {
      const b = this.blocks.get(i)!
      if (b.kind === 'text') {
        const text = b.textParts.join('')
        if (text) content.push({ type: 'text', text })
      } else if (b.kind === 'thinking') {
        const thinking = b.thinkingParts.join('')
        if (thinking) content.push({ type: 'thinking', thinking })
      } else if (b.kind === 'tool_use') {
        const argsRaw = b.toolUseJsonParts.join('')
        let input: unknown = {}
        if (argsRaw.length > 0) {
          try {
            input = JSON.parse(argsRaw)
          } catch {
            input = { _raw: argsRaw }
          }
        }
        content.push({
          type: 'tool_use',
          id: b.toolUseId ?? `toolu_idx_${i}`,
          name: b.toolUseName ?? 'unknown',
          input,
        })
      }
    }
    return {
      id: this.id,
      type: 'message',
      role: 'assistant',
      model: this.model,
      content,
      stop_reason: this.stopReason,
      stop_sequence: this.stopSequence,
      usage: this.usage,
    }
  }
}
