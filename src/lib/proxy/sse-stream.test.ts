import { describe, expect, it } from 'vitest'
import { SseEventStream } from './sse-stream'

const encoder = new TextEncoder()

describe('SseEventStream', () => {
  it('parses a single complete event', () => {
    const s = new SseEventStream()
    const events = s.push(encoder.encode('data: hello\n\n'))
    expect(events).toEqual([{ data: 'hello' }])
  })

  it('parses event + data fields together', () => {
    const s = new SseEventStream()
    const ev = s.push(encoder.encode('event: message_start\ndata: {"x":1}\n\n'))
    expect(ev).toEqual([{ event: 'message_start', data: '{"x":1}' }])
  })

  it('buffers across chunk boundaries (event split mid-record)', () => {
    const s = new SseEventStream()
    let evs: { event?: string; data: string }[] = []
    evs = evs.concat(s.push(encoder.encode('data: ')))
    evs = evs.concat(s.push(encoder.encode('hello\n')))
    expect(evs).toEqual([])
    evs = evs.concat(s.push(encoder.encode('\ndata: world\n\n')))
    expect(evs).toEqual([{ data: 'hello' }, { data: 'world' }])
  })

  it('handles multibyte UTF-8 split across chunks (the 中 character is 3 bytes)', () => {
    // '中' = E4 B8 AD. Send first 2 bytes, then 3rd byte + terminator.
    const buf = encoder.encode('data: 中\n\n')
    const s = new SseEventStream()
    const a = s.push(buf.slice(0, 8)) // up to part of "中"
    const b = s.push(buf.slice(8))
    const all = [...a, ...b]
    expect(all).toEqual([{ data: '中' }])
  })

  it('handles \\r\\n\\r\\n separators (some servers use CRLF)', () => {
    const s = new SseEventStream()
    const evs = s.push(encoder.encode('data: one\r\n\r\ndata: two\r\n\r\n'))
    expect(evs).toEqual([{ data: 'one' }, { data: 'two' }])
  })

  it('skips empty / comment / id-only records but preserves real data', () => {
    const s = new SseEventStream()
    const evs = s.push(
      encoder.encode(
        ':\n\nid: 5\n\ndata: real\n\n: heartbeat\nid: 6\ndata: also\n\n',
      ),
    )
    expect(evs.map((e) => e.data)).toEqual(['real', 'also'])
  })

  it('handles multi-line data (concatenated with \\n)', () => {
    const s = new SseEventStream()
    const evs = s.push(encoder.encode('data: line1\ndata: line2\n\n'))
    expect(evs).toEqual([{ data: 'line1\nline2' }])
  })

  it('flushFinal emits a trailing event missing its terminator', () => {
    const s = new SseEventStream()
    const mid = s.push(encoder.encode('data: trailing'))
    expect(mid).toEqual([])
    const final = s.flushFinal()
    expect(final).toEqual([{ data: 'trailing' }])
  })

  it('respects the OpenAI [DONE] sentinel (it is a literal data value, not JSON)', () => {
    const s = new SseEventStream()
    const evs = s.push(
      encoder.encode('data: {"id":"x"}\n\ndata: [DONE]\n\n'),
    )
    expect(evs.map((e) => e.data)).toEqual(['{"id":"x"}', '[DONE]'])
  })

  it('strips exactly one leading space after the colon (spec)', () => {
    const s = new SseEventStream()
    // 'data:no-space' vs 'data: with-space' vs 'data:  two-spaces'
    const evs = s.push(
      encoder.encode(
        'data:no-space\n\ndata: with-space\n\ndata:  two-spaces\n\n',
      ),
    )
    expect(evs.map((e) => e.data)).toEqual([
      'no-space',
      'with-space',
      ' two-spaces', // only ONE space is stripped
    ])
  })
})
