import { describe, expect, it } from 'vitest'
import { OpenAIStreamAccumulator } from './openai-stream-adapter'

/**
 * These deltas are real-shape (taken from OpenAI / Doubao live streams).
 * Each call to `feed()` is one SSE `data:` payload — the actual proxy gets
 * them out of the SseEventStream parser one by one.
 */

describe('OpenAIStreamAccumulator', () => {
  it('accumulates plain text deltas into a single content string', () => {
    const acc = new OpenAIStreamAccumulator()
    acc.feed(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'doubao-1-5-pro-32k',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' } }],
      }),
    )
    acc.feed(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'doubao-1-5-pro-32k',
        choices: [{ index: 0, delta: { content: ', ' } }],
      }),
    )
    acc.feed(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'doubao-1-5-pro-32k',
        choices: [{ index: 0, delta: { content: 'world!' } }],
      }),
    )
    acc.feed(
      JSON.stringify({
        id: 'chatcmpl-1',
        model: 'doubao-1-5-pro-32k',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
      }),
    )

    const final = acc.toFinalResponse()
    expect(final.id).toBe('chatcmpl-1')
    expect(final.model).toBe('doubao-1-5-pro-32k')
    expect(final.choices[0].message.content).toBe('Hello, world!')
    expect(final.choices[0].finish_reason).toBe('stop')
    expect(final.usage?.total_tokens).toBe(7)
  })

  it('preserves multi-byte text deltas verbatim', () => {
    const acc = new OpenAIStreamAccumulator()
    const parts = ['今天', '上海', '天气', '不错']
    for (const p of parts) {
      acc.feed(JSON.stringify({ choices: [{ delta: { content: p } }] }))
    }
    expect(acc.toFinalResponse().choices[0].message.content).toBe(
      '今天上海天气不错',
    )
  })

  it('captures reasoning_content into its own field (Doubao R-line)', () => {
    const acc = new OpenAIStreamAccumulator()
    acc.feed(
      JSON.stringify({
        choices: [{ delta: { reasoning_content: 'let me think' } }],
      }),
    )
    acc.feed(
      JSON.stringify({
        choices: [{ delta: { reasoning_content: ' carefully' } }],
      }),
    )
    acc.feed(JSON.stringify({ choices: [{ delta: { content: 'answer' } }] }))

    const final = acc.toFinalResponse()
    const msg = final.choices[0].message
    expect((msg as { reasoning_content?: string }).reasoning_content).toBe(
      'let me think carefully',
    )
    expect(msg.content).toBe('answer')
  })

  it('reassembles tool_call arguments split across many deltas', () => {
    const acc = new OpenAIStreamAccumulator()
    // First delta: id + name (no args yet)
    acc.feed(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_abc',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '' },
                },
              ],
            },
          },
        ],
      }),
    )
    // Args drip in across deltas (real OpenAI behaviour)
    for (const piece of ['{"', 'city"', ':"上海"', '}']) {
      acc.feed(
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: piece } },
                ],
              },
            },
          ],
        }),
      )
    }
    acc.feed(
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
      }),
    )

    const final = acc.toFinalResponse()
    const tcs = final.choices[0].message.tool_calls
    expect(tcs).toHaveLength(1)
    expect(tcs![0].id).toBe('call_abc')
    expect(tcs![0].function.name).toBe('get_weather')
    expect(JSON.parse(tcs![0].function.arguments)).toEqual({ city: '上海' })
    expect(final.choices[0].finish_reason).toBe('tool_calls')
  })

  it('ignores [DONE] sentinel and unparseable chunks', () => {
    const acc = new OpenAIStreamAccumulator()
    expect(acc.feed('[DONE]')).toBe(false)
    expect(acc.feed('not-json')).toBe(false)
    expect(acc.feed('')).toBe(false)
    expect(acc.sawAnyChunk).toBe(false)
  })

  it('handles multiple parallel tool_calls (real agent loop)', () => {
    const acc = new OpenAIStreamAccumulator()
    acc.feed(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_a',
                  type: 'function',
                  function: { name: 'fn_a', arguments: '{"x":1}' },
                },
                {
                  index: 1,
                  id: 'call_b',
                  type: 'function',
                  function: { name: 'fn_b', arguments: '{"y":2}' },
                },
              ],
            },
          },
        ],
      }),
    )
    const final = acc.toFinalResponse()
    const tcs = final.choices[0].message.tool_calls!
    expect(tcs).toHaveLength(2)
    expect(tcs[0].function.name).toBe('fn_a')
    expect(tcs[1].function.name).toBe('fn_b')
  })

  it('marks the message content as null when only tool_calls were emitted', () => {
    const acc = new OpenAIStreamAccumulator()
    acc.feed(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_x',
                  function: { name: 'tool_x', arguments: '{}' },
                },
              ],
            },
          },
        ],
      }),
    )
    const final = acc.toFinalResponse()
    expect(final.choices[0].message.content).toBeNull()
  })
})
