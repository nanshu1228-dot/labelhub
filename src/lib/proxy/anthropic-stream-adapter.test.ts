import { describe, expect, it } from 'vitest'
import { AnthropicStreamAccumulator } from './anthropic-stream-adapter'

/**
 * Fixtures here mirror what api.anthropic.com sends when `stream: true`.
 * Event names + payload shapes from the Messages streaming docs.
 */

function payload(t: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: t, ...extra })
}

describe('AnthropicStreamAccumulator', () => {
  it('reassembles a plain text reply across delta chunks', () => {
    const a = new AnthropicStreamAccumulator()
    a.feed(
      'message_start',
      payload('message_start', {
        message: {
          id: 'msg_01',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 12 },
        },
      }),
    )
    a.feed(
      'content_block_start',
      payload('content_block_start', {
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
    )
    for (const piece of ['Hello', ', ', 'world', '!']) {
      a.feed(
        'content_block_delta',
        payload('content_block_delta', {
          index: 0,
          delta: { type: 'text_delta', text: piece },
        }),
      )
    }
    a.feed(
      'content_block_stop',
      payload('content_block_stop', { index: 0 }),
    )
    a.feed(
      'message_delta',
      payload('message_delta', {
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 4 },
      }),
    )
    a.feed('message_stop', payload('message_stop'))

    const final = a.toFinalResponse()
    expect(final.id).toBe('msg_01')
    expect(final.model).toBe('claude-sonnet-4-6')
    expect(final.content).toHaveLength(1)
    expect(final.content[0]).toEqual({ type: 'text', text: 'Hello, world!' })
    expect(final.stop_reason).toBe('end_turn')
    expect(final.usage).toEqual({ input_tokens: 12, output_tokens: 4 })
  })

  it('captures multi-byte text verbatim through deltas', () => {
    const a = new AnthropicStreamAccumulator()
    a.feed(
      'content_block_start',
      payload('content_block_start', {
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
    )
    for (const piece of ['今天', '上海', '气温', ' 18°C']) {
      a.feed(
        'content_block_delta',
        payload('content_block_delta', {
          index: 0,
          delta: { type: 'text_delta', text: piece },
        }),
      )
    }
    expect((a.toFinalResponse().content[0] as { text: string }).text).toBe(
      '今天上海气温 18°C',
    )
  })

  it('reassembles tool_use input from streamed JSON partials', () => {
    const a = new AnthropicStreamAccumulator()
    a.feed(
      'content_block_start',
      payload('content_block_start', {
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'toolu_01',
          name: 'get_weather',
          input: {},
        },
      }),
    )
    // Partial JSON drips in
    const partials = ['{"city', '":"上', '海"}']
    for (const p of partials) {
      a.feed(
        'content_block_delta',
        payload('content_block_delta', {
          index: 0,
          delta: { type: 'input_json_delta', partial_json: p },
        }),
      )
    }
    a.feed(
      'content_block_stop',
      payload('content_block_stop', { index: 0 }),
    )
    a.feed(
      'message_delta',
      payload('message_delta', { delta: { stop_reason: 'tool_use' } }),
    )

    const final = a.toFinalResponse()
    expect(final.content).toHaveLength(1)
    expect(final.content[0]).toEqual({
      type: 'tool_use',
      id: 'toolu_01',
      name: 'get_weather',
      input: { city: '上海' },
    })
    expect(final.stop_reason).toBe('tool_use')
  })

  it('emits thinking + text in the original index order', () => {
    const a = new AnthropicStreamAccumulator()
    // index 0 = thinking, index 1 = text  (extended-thinking mode)
    a.feed(
      'content_block_start',
      payload('content_block_start', {
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      }),
    )
    a.feed(
      'content_block_delta',
      payload('content_block_delta', {
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let me reason. ' },
      }),
    )
    a.feed(
      'content_block_delta',
      payload('content_block_delta', {
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Done.' },
      }),
    )
    a.feed(
      'content_block_stop',
      payload('content_block_stop', { index: 0 }),
    )
    a.feed(
      'content_block_start',
      payload('content_block_start', {
        index: 1,
        content_block: { type: 'text', text: '' },
      }),
    )
    a.feed(
      'content_block_delta',
      payload('content_block_delta', {
        index: 1,
        delta: { type: 'text_delta', text: 'Answer.' },
      }),
    )

    const final = a.toFinalResponse()
    expect(final.content).toHaveLength(2)
    expect(final.content[0]).toEqual({
      type: 'thinking',
      thinking: 'Let me reason. Done.',
    })
    expect(final.content[1]).toEqual({ type: 'text', text: 'Answer.' })
  })

  it('falls back to raw bytes when tool_use partial JSON never closes', () => {
    const a = new AnthropicStreamAccumulator()
    a.feed(
      'content_block_start',
      payload('content_block_start', {
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'toolu_99',
          name: 'broken',
          input: {},
        },
      }),
    )
    a.feed(
      'content_block_delta',
      payload('content_block_delta', {
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"city": ' },
      }),
    )
    // Stream cuts off before the JSON is complete.
    const final = a.toFinalResponse()
    const block = final.content[0] as {
      type: string
      input: { _raw?: string }
    }
    expect(block.type).toBe('tool_use')
    expect(block.input._raw).toBe('{"city": ')
  })

  it('ignores ping events without breaking the stream', () => {
    const a = new AnthropicStreamAccumulator()
    a.feed('ping', payload('ping'))
    a.feed('ping', payload('ping'))
    a.feed(
      'content_block_start',
      payload('content_block_start', {
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
    )
    a.feed(
      'content_block_delta',
      payload('content_block_delta', {
        index: 0,
        delta: { type: 'text_delta', text: 'ok' },
      }),
    )
    const final = a.toFinalResponse()
    expect((final.content[0] as { text: string }).text).toBe('ok')
  })

  it('captures upstream error events for diagnostics', () => {
    const a = new AnthropicStreamAccumulator()
    a.feed(
      'error',
      payload('error', {
        error: { type: 'overloaded_error', message: 'too many requests' },
      }),
    )
    expect(a.streamError).toBe('too many requests')
  })
})
