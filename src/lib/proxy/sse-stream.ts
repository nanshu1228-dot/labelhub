/**
 * Server-Sent Events stream parser.
 *
 * Decodes a chunked byte stream (as you get out of `fetch(...).body`) into
 * discrete SSE events, buffering across chunk boundaries.
 *
 * Two gotchas this handles correctly:
 *   1. **Multi-byte UTF-8 split across chunks.** `TextDecoder` in stream mode
 *      holds back any trailing incomplete code-point bytes until the next push.
 *      Without this, a Chinese character bisected by a chunk boundary turns
 *      into U+FFFD garbage in the captured trajectory.
 *   2. **Event boundaries split across chunks.** SSE events are delimited by
 *      `\n\n`; chunks may arrive mid-event. We accumulate in a string buffer
 *      and only emit complete events.
 *
 * The wire format we accept (RFC 2118 / WHATWG EventSource):
 *
 *     event: <name>            (optional)
 *     data: <payload>           (one or more lines; concatenated with \n)
 *     id: <id>                  (ignored)
 *     retry: <ms>               (ignored)
 *                                (blank line terminates event)
 *     event: ...
 *     data: ...
 *
 * OpenAI / Doubao streams emit `data:` only. Anthropic emits both `event:` and `data:`.
 */

export interface SseEvent {
  /** OpenAI / Doubao don't set this; Anthropic does. */
  event?: string
  /** Raw payload (typically JSON, sometimes the literal `[DONE]`). */
  data: string
}

export class SseEventStream {
  private buffer = ''
  private decoder = new TextDecoder('utf-8')

  /**
   * Feed one chunk of bytes from the upstream `Response.body` reader.
   * Returns every COMPLETE event present so far. Partial events are kept
   * for the next push.
   */
  push(bytes: Uint8Array): SseEvent[] {
    this.buffer += this.decoder.decode(bytes, { stream: true })
    return this.drain()
  }

  /**
   * Called once after the upstream reader returns `done: true`. Flushes the
   * decoder's internal multi-byte tail AND emits any remaining buffered
   * record (some servers omit the final \n\n before closing the connection).
   */
  flushFinal(): SseEvent[] {
    this.buffer += this.decoder.decode()
    const out = this.drain()
    // If a trailing event was missing its \n\n terminator, drain leaves it
    // in the buffer. Best-effort parse it now.
    const tail = this.buffer.trim()
    this.buffer = ''
    if (tail.length > 0) {
      const ev = parseEventRecord(tail)
      if (ev) out.push(ev)
    }
    return out
  }

  private drain(): SseEvent[] {
    const events: SseEvent[] = []
    while (true) {
      // SSE allows \n\n or \r\n\r\n as event boundary. Look for either.
      const dn = this.buffer.indexOf('\n\n')
      const dr = this.buffer.indexOf('\r\n\r\n')
      let idx: number
      let sep: number
      if (dr !== -1 && (dn === -1 || dr < dn)) {
        idx = dr
        sep = 4
      } else if (dn !== -1) {
        idx = dn
        sep = 2
      } else {
        break
      }
      const record = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + sep)
      const ev = parseEventRecord(record)
      if (ev) events.push(ev)
    }
    return events
  }
}

/**
 * Parse a single record (between two blank lines) into an SseEvent.
 * Returns null when the record has no `data:` lines (just comments / `id:` etc.).
 */
function parseEventRecord(record: string): SseEvent | null {
  let event: string | undefined
  const dataLines: string[] = []
  for (const rawLine of record.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line === '' || line.startsWith(':')) continue // comment / keep-alive
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon)
    // Spec: a single space after the colon is part of the formatting, strip it.
    let value = line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') {
      event = value
    } else if (field === 'data') {
      dataLines.push(value)
    }
    // id / retry ignored
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}
