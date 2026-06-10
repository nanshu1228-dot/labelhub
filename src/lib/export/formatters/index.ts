/**
 * Formatter registry — Finals P4 D15.
 *
 * Same shape as the import-parser registry. One `pickFormatterFor()`
 * lookup; the API route + the export-history page both go through
 * here.
 */

import { formatCSV } from './csv'
import { formatExcel } from './excel'
import { formatJSON } from './json'
import { formatJSONL } from './jsonl'
import type { RowFormatter } from './types'

export type ExportFormat = 'json' | 'jsonl' | 'csv' | 'excel'

export const FORMATTERS: Record<ExportFormat, RowFormatter> = {
  json: formatJSON,
  jsonl: formatJSONL,
  csv: formatCSV,
  excel: formatExcel,
}

export function pickFormatterFor(format: ExportFormat): RowFormatter {
  return FORMATTERS[format]
}

export function isExportFormat(s: string | null): s is ExportFormat {
  return s === 'json' || s === 'jsonl' || s === 'csv' || s === 'excel'
}

export {
  formatCSV,
  formatExcel,
  formatJSON,
  formatJSONL,
}
export type {
  FieldMapping,
  FormatOptions,
  RowFormatter,
} from './types'
