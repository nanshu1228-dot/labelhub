/**
 * JSON array parser — Finals P4 D14.
 *
 * Reads a single JSON document where the root is an array of row
 * objects. Spec 4.1: alternate to JSONL when the user has a hand-
 * curated `[ {...}, {...} ]` file. The parser materializes the whole
 * input (must — JSON.parse isn't streaming), so the upload route
 * enforces the same 50MB cap as the other formats.
 *
 * Differences from JSONL:
 *   - Root MUST be an array. Non-array root → first row carries the
 *     error, then iteration ends (caller sees the failure in row 1).
 *   - Per-row errors are non-fatal in non-strict mode just like the
 *     other parsers — a single non-object element yields an error
 *     row and the rest continue.
 */

import { DEFAULT_MAX_ROWS, type ParsedRow, type ParserOptions } from './types'

export async function* parseJSON(
  input: AsyncIterable<Uint8Array> | string | Uint8Array,
  opts: ParserOptions = {},
): AsyncIterable<ParsedRow> {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS
  const text = await collectToString(input)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    if (opts.strict) {
      throw new Error(
        `JSON parse failed: ${e instanceof Error ? e.message : 'invalid JSON'}`,
      )
    }
    yield {
      lineNumber: 1,
      row: null,
      error: `JSON parse failed: ${e instanceof Error ? e.message : 'invalid JSON'}`,
    }
    return
  }
  if (!Array.isArray(parsed)) {
    if (opts.strict) {
      throw new Error('JSON root must be an array of row objects.')
    }
    yield {
      lineNumber: 1,
      row: null,
      error: 'JSON root must be an array of row objects.',
    }
    return
  }
  for (let i = 0; i < parsed.length; i++) {
    if (i >= maxRows) return
    const r = parsed[i]
    const lineNumber = i + 1
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      if (opts.strict) {
        throw new Error(`Row ${lineNumber}: expected an object, got ${typeof r}.`)
      }
      yield {
        lineNumber,
        row: null,
        error: `expected an object, got ${typeof r}`,
      }
      continue
    }
    yield { lineNumber, row: r }
  }
}

async function collectToString(
  input: AsyncIterable<Uint8Array> | string | Uint8Array,
): Promise<string> {
  if (typeof input === 'string') return input
  if (input instanceof Uint8Array) {
    return new TextDecoder('utf-8').decode(input)
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const c of input) {
    chunks.push(c)
    total += c.length
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return new TextDecoder('utf-8').decode(out)
}
