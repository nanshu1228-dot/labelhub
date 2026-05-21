/**
 * CSV formatter — Finals P4 D15.
 *
 * Streams RFC 4180-flavored CSV. Header is derived from the field
 * mapping if present, else from the keys of the FIRST row. Cells
 * are stringified via JSON-stringify for non-primitives so nested
 * structures round-trip cleanly.
 *
 * Defensive escaping: any cell containing a comma, quote, newline,
 * or starts with one of `=+-@` (Excel formula injection) gets
 * quoted; quotes inside cells double to "".
 */

import { projectRow, type RowFormatter } from './types'

const TE = new TextEncoder()

export const formatCSV: RowFormatter = async function* (rows, opts = {}) {
  let headerWritten = false
  let columns: string[] = []
  if (opts.mapping && opts.mapping.length > 0) {
    columns = opts.mapping.map((m) => m.target)
    yield TE.encode(rowToCsv(columns) + '\n')
    headerWritten = true
  }
  for await (const row of rows) {
    const projected = projectRow(row, opts.mapping)
    if (!headerWritten) {
      columns = Object.keys(projected)
      yield TE.encode(rowToCsv(columns) + '\n')
      headerWritten = true
    }
    const cells = columns.map((c) => cellToString(projected[c]))
    yield TE.encode(rowToCsv(cells) + '\n')
  }
  // No-rows case: emit nothing (caller can branch on Content-Length=0
  // if needed). Header without rows would be a false-positive payload.
}

formatCSV.meta = {
  contentType: 'text/csv; charset=utf-8',
  extension: 'csv',
}

function rowToCsv(cells: ReadonlyArray<string>): string {
  return cells.map(escapeCsvCell).join(',')
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function escapeCsvCell(s: string): string {
  const needsQuote =
    s.includes(',') ||
    s.includes('"') ||
    s.includes('\n') ||
    s.includes('\r') ||
    // Defuse Excel formula injection: cells starting with =, +, -, @
    // get prefixed with a single quote inside a quoted string.
    /^[=+\-@]/.test(s)
  if (!needsQuote) return s
  const escaped = s.replace(/"/g, '""')
  return /^[=+\-@]/.test(s) ? `"'${escaped}"` : `"${escaped}"`
}
