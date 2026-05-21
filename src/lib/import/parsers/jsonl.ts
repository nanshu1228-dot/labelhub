/**
 * JSONL (newline-delimited JSON) parser — Finals P4 D14.
 *
 * The dataset format the existing /api/export/dataset endpoint
 * emits, and the most common format for LLM eval datasets. Each
 * line is an independent JSON value; blank lines are skipped; a
 * malformed line yields a `null` row + an error message so the
 * caller can show "row N failed: <reason>" without aborting the
 * batch.
 *
 * Streams via a UTF-8 line splitter so a 1M-row file doesn't
 * materialize as one giant string. Both `string` and `Uint8Array`
 * inputs are accepted; `AsyncIterable<Uint8Array>` is for the
 * Request body case (uploads).
 */

import { DEFAULT_MAX_ROWS, type ParsedRow, type ParserOptions } from './types'

export async function* parseJSONL(
  input: AsyncIterable<Uint8Array> | string | Uint8Array,
  opts: ParserOptions = {},
): AsyncIterable<ParsedRow> {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS
  let lineNumber = 0
  let emitted = 0

  for await (const line of streamLines(input)) {
    lineNumber++
    const trimmed = line.trim()
    if (trimmed === '') continue
    let row: unknown
    try {
      row = JSON.parse(trimmed)
    } catch (e) {
      if (opts.strict) {
        throw new Error(`JSONL line ${lineNumber}: ${e instanceof Error ? e.message : 'parse failed'}`)
      }
      yield {
        lineNumber,
        row: null,
        error: `parse failed: ${e instanceof Error ? e.message : 'invalid JSON'}`,
      }
      continue
    }
    yield { lineNumber, row }
    emitted++
    if (emitted >= maxRows) return
  }
}

/**
 * UTF-8 line splitter. Yields one trimmed-of-trailing-\r line per
 * iteration; the final partial line (no trailing newline) is also
 * emitted so it doesn't get silently dropped.
 *
 * Accepts string / Uint8Array / AsyncIterable<Uint8Array>. For
 * AsyncIterable, the buffer between chunks holds the partial line
 * across chunk boundaries.
 */
export async function* streamLines(
  input: AsyncIterable<Uint8Array> | string | Uint8Array,
): AsyncIterable<string> {
  if (typeof input === 'string') {
    yield* splitString(input)
    return
  }
  if (input instanceof Uint8Array) {
    yield* splitString(new TextDecoder('utf-8').decode(input))
    return
  }
  // AsyncIterable<Uint8Array> — stream a TextDecoder across chunks.
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let buffer = ''
  for await (const chunk of input) {
    buffer += decoder.decode(chunk, { stream: true })
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      yield line.endsWith('\r') ? line.slice(0, -1) : line
      nl = buffer.indexOf('\n')
    }
  }
  // Flush the trailing partial line (if any).
  buffer += decoder.decode()
  if (buffer.length > 0) {
    yield buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
  }
}

function* splitString(s: string): Iterable<string> {
  let start = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\n') {
      const end = i > 0 && s[i - 1] === '\r' ? i - 1 : i
      yield s.slice(start, end)
      start = i + 1
    }
  }
  if (start < s.length) {
    const tail = s.slice(start)
    yield tail.endsWith('\r') ? tail.slice(0, -1) : tail
  }
}
