/**
 * Excel (.xlsx) formatter — Finals P4 D15.
 *
 * SheetJS doesn't stream writes — the workbook is built in memory
 * then serialized in one buffer. We accept that trade-off because
 * Excel files past 10MB are rare in annotation work, and the
 * `export_jobs` async-queue path kicks in for large dumps anyway.
 *
 * Header derived from field mapping when present; else from the
 * FIRST row's keys. Cells with object / array values get
 * JSON-stringified so the spreadsheet stays readable (the user can
 * re-parse via Excel formula or import back via the D14 reader).
 */

import * as XLSX from 'xlsx'
import { projectRow, type RowFormatter } from './types'

export const formatExcel: RowFormatter = async function* (rows, opts = {}) {
  const collected: Record<string, unknown>[] = []
  for await (const row of rows) {
    collected.push(projectRow(row, opts.mapping))
  }

  let columns: string[] = []
  if (opts.mapping && opts.mapping.length > 0) {
    columns = opts.mapping.map((m) => m.target)
  } else if (collected.length > 0) {
    columns = Object.keys(collected[0])
  }

  const aoa: unknown[][] = []
  aoa.push(columns)
  for (const r of collected) {
    aoa.push(columns.map((c) => cellize(r[c])))
  }

  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  XLSX.utils.book_append_sheet(wb, sheet, opts.sheetName ?? 'Sheet1')
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  // XLSX returns ArrayBuffer when type='array'. Coerce to Uint8Array
  // so the result is a Response.body-friendly chunk.
  yield buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : (buffer as Uint8Array)
}

formatExcel.meta = {
  contentType:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  extension: 'xlsx',
}

function cellize(v: unknown): unknown {
  if (v === null || v === undefined) return ''
  if (
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
  ) {
    return v
  }
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
