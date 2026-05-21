/**
 * Excel parser — Finals P4 D14.
 *
 * Uses SheetJS CE (`xlsx`). Reads the first sheet, treats row 1 as
 * the header, emits each subsequent row as a `Record<string, unknown>`.
 *
 * Why first sheet only: the import UI displays the sheet name + 10-
 * row preview, and the spec doesn't require multi-sheet handling.
 * A v2 would accept a `sheetName` option; today the test cap is
 * 500 rows so the simpler path wins.
 *
 * SheetJS doesn't stream — workbooks are read into memory and rows
 * lazily iterated. The upload route's 50MB cap bounds the memory
 * footprint. Per-row try/catch ensures one weird cell never aborts
 * the batch.
 */

import * as XLSX from 'xlsx'
import { DEFAULT_MAX_ROWS, type ParsedRow, type ParserOptions } from './types'

export async function* parseExcel(
  input: AsyncIterable<Uint8Array> | string | Uint8Array,
  opts: ParserOptions = {},
): AsyncIterable<ParsedRow> {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS
  const buffer = await collectToBuffer(input)
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'array' })
  } catch (e) {
    if (opts.strict) {
      throw new Error(
        `Excel parse failed: ${e instanceof Error ? e.message : 'invalid workbook'}`,
      )
    }
    yield {
      lineNumber: 1,
      row: null,
      error: `Excel parse failed: ${e instanceof Error ? e.message : 'invalid workbook'}`,
    }
    return
  }
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    if (opts.strict) throw new Error('Excel workbook has no sheets.')
    yield { lineNumber: 1, row: null, error: 'workbook has no sheets' }
    return
  }
  const sheet = workbook.Sheets[sheetName]
  // sheet_to_json with header:1 returns rows as arrays; { defval: '' }
  // preserves empty cells.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  })
  if (rows.length === 0) return

  // Find the first non-empty row to use as the header. Skips the
  // "spreadsheet with banner row above the header" pattern.
  let headerIdx = 0
  while (
    headerIdx < rows.length &&
    rows[headerIdx].every((c) => c == null || c === '')
  ) {
    headerIdx++
  }
  if (headerIdx >= rows.length) return
  const header = (rows[headerIdx] as unknown[]).map((h) => String(h).trim())

  let emitted = 0
  for (let i = headerIdx + 1; i < rows.length; i++) {
    if (emitted >= maxRows) return
    const cells = rows[i] as unknown[]
    const lineNumber = i + 1 // 1-indexed; matches the spreadsheet row number
    if (
      !cells ||
      cells.length === 0 ||
      cells.every((c) => c == null || c === '')
    ) {
      continue
    }
    const row: Record<string, unknown> = {}
    try {
      for (let c = 0; c < header.length; c++) {
        const key = header[c]
        if (!key) continue
        row[key] = cells[c] ?? ''
      }
    } catch (e) {
      if (opts.strict) {
        throw new Error(
          `Excel row ${lineNumber}: ${e instanceof Error ? e.message : 'cell read failed'}`,
        )
      }
      yield {
        lineNumber,
        row: null,
        error: e instanceof Error ? e.message : 'cell read failed',
      }
      continue
    }
    yield { lineNumber, row }
    emitted++
  }
}

async function collectToBuffer(
  input: AsyncIterable<Uint8Array> | string | Uint8Array,
): Promise<Uint8Array> {
  if (typeof input === 'string') {
    return new TextEncoder().encode(input)
  }
  if (input instanceof Uint8Array) {
    return input
  }
  // Defensive: xlsx's `type: 'array'` write returns an ArrayBuffer
  // when caller forwards it here directly. Coerce to Uint8Array.
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input)
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
  return out
}
