/**
 * CSV parser — Finals P4 D14.
 *
 * RFC 4180-ish: comma-separated, double-quoted strings with "" escape,
 * newline-terminated rows. First non-empty line is the header; every
 * subsequent line maps cells to header keys.
 *
 * Why hand-rolled (no papaparse): one dep less, fits in <100 lines,
 * and the row shape we emit is identical to the other parsers'.
 * Edge cases covered by the tests:
 *   - quoted commas inside cells
 *   - escaped quotes ("") inside cells
 *   - mixed CRLF / LF line endings
 *   - empty cells preserved as empty string
 *   - mismatched column count yields an error row (lineNumber preserved)
 *
 * Excel-flavored quirks (BOM, leading whitespace in quoted cells) are
 * handled by the upload page stripping the BOM before invoking this.
 */

import { DEFAULT_MAX_ROWS, type ParsedRow, type ParserOptions } from './types'

export async function* parseCSV(
  input: AsyncIterable<Uint8Array> | string | Uint8Array,
  opts: ParserOptions = {},
): AsyncIterable<ParsedRow> {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS
  const text = await collectToString(input)
  const stripped = text.startsWith('﻿') ? text.slice(1) : text
  const rows = parseCsvRows(stripped)
  if (rows.length === 0) return

  // Header row — first non-empty.
  let headerIdx = 0
  while (headerIdx < rows.length && rows[headerIdx].every((c) => c === '')) {
    headerIdx++
  }
  if (headerIdx >= rows.length) return
  const header = rows[headerIdx]
  const headerKeys = header.map((h) => h.trim())

  let emitted = 0
  for (let i = headerIdx + 1; i < rows.length; i++) {
    if (emitted >= maxRows) return
    const cells = rows[i]
    const lineNumber = i + 1 // 1-indexed; header row's line stays numbered
    // Skip totally-empty rows (trailing blank lines).
    if (cells.length === 0 || cells.every((c) => c === '')) continue
    if (cells.length !== headerKeys.length) {
      const msg = `expected ${headerKeys.length} columns, got ${cells.length}`
      if (opts.strict) throw new Error(`CSV row ${lineNumber}: ${msg}`)
      yield { lineNumber, row: null, error: msg }
      continue
    }
    const row: Record<string, string> = {}
    for (let c = 0; c < headerKeys.length; c++) {
      row[headerKeys[c]] = cells[c]
    }
    yield { lineNumber, row }
    emitted++
  }
}

/**
 * Pure CSV tokenizer. State-machine over each character; supports
 * quoted strings + "" escape + CRLF + LF line endings. Returns
 * `string[][]` — the caller (parseCSV) applies header mapping.
 *
 * Exported for unit tests so the per-edge-case matrix can hit the
 * tokenizer directly without going through parseCSV's iteration.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        // Either escaped quote ("") or end of quoted cell.
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (ch === '\n' || ch === '\r') {
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
      // Skip the \n of a \r\n pair.
      if (ch === '\r' && text[i + 1] === '\n') i++
      continue
    }
    cell += ch
  }
  // Flush trailing cell + row (handles files without a final newline).
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
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
