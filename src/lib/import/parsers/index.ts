/**
 * Parser registry — Finals P4 D14.
 *
 * One factory `pickParserFor(format)` lookups + a small detector
 * function so the upload UI doesn't have to switch on MIME types
 * directly. The API route + the page both go through here.
 */

import { parseCSV } from './csv'
import { parseExcel } from './excel'
import { parseJSON } from './json'
import { parseJSONL } from './jsonl'
import type { RowParser } from './types'

export type ImportFormat = 'json' | 'jsonl' | 'csv' | 'excel'

export const PARSERS: Record<ImportFormat, RowParser> = {
  json: parseJSON,
  jsonl: parseJSONL,
  csv: parseCSV,
  excel: parseExcel,
}

export function pickParserFor(format: ImportFormat): RowParser {
  return PARSERS[format]
}

/**
 * Best-effort format detection from a filename. The upload UI uses
 * this to seed the format dropdown; the user can still override.
 */
export function detectFormat(filename: string): ImportFormat | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'jsonl'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'csv'
  if (
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    lower.endsWith('.xlsm')
  ) {
    return 'excel'
  }
  return null
}

export { parseJSON, parseJSONL, parseCSV, parseExcel }
export type { ParsedRow, ParserOptions, RowParser } from './types'
