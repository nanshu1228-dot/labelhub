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
    const cells = columns.map((c) => cellToCsv(projected[c]))
    yield TE.encode(cells.join(',') + '\n')
  }
  // No-rows case: emit nothing (caller can branch on Content-Length=0
  // if needed). Header without rows would be a false-positive payload.
}

formatCSV.meta = {
  contentType: 'text/csv; charset=utf-8',
  extension: 'csv',
}

function rowToCsv(cells: ReadonlyArray<string>): string {
  // Header cells are column names (always strings) and so get the
  // full escaping, including the formula-injection guard.
  return cells.map((c) => escapeCsvCell(c, true)).join(',')
}

/**
 * Serialize a single projected value into a CSV cell.
 *
 * The formula-injection guard is applied ONLY to string-typed cells:
 * numbers, booleans, and null serialize verbatim so a legitimately
 * negative number like -5 stays "-5" rather than being mangled into
 * "'-5". Non-primitive values are JSON-stringified and treated as
 * strings (they may begin with a guarded prefix and could be reopened
 * in a spreadsheet, so they keep the guard).
 */
function cellToCsv(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return escapeCsvCell(v, true)
  if (typeof v === 'number' || typeof v === 'boolean') {
    return escapeCsvCell(String(v), false)
  }
  let s: string
  try {
    s = JSON.stringify(v)
  } catch {
    s = String(v)
  }
  return escapeCsvCell(s, true)
}

/**
 * RFC 4180 escaping. `guardFormula` enables the Excel
 * formula-injection defense (cells starting with =, +, -, @ get a
 * leading single quote inside a quoted string). It must be off for
 * numeric/boolean cells so values like -5 round-trip unchanged.
 */
function escapeCsvCell(s: string, guardFormula: boolean): string {
  const isFormula = guardFormula && /^[=+\-@]/.test(s)
  const needsQuote =
    s.includes(',') ||
    s.includes('"') ||
    s.includes('\n') ||
    s.includes('\r') ||
    isFormula
  if (!needsQuote) return s
  const escaped = s.replace(/"/g, '""')
  return isFormula ? `"'${escaped}"` : `"${escaped}"`
}
