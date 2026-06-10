/**
 * Import wizard — pure helpers, static data, and constants.
 *
 * Extracted verbatim from `import-wizard.tsx` (behavior-preserving
 * relocation). No state, no hooks — just format/strategy tables,
 * preview-cell formatting, and the ghost-button style token.
 */

import type { CSSProperties } from 'react'
import {
  FileJson,
  FileSpreadsheet,
  FileText,
  TableProperties,
} from 'lucide-react'
import type { ImportFormat, ParsedRow } from '@/lib/import/parsers'
import type { DistributionStrategy } from '@/lib/import/distribution'

export const FORMAT_LABELS: Record<ImportFormat, string> = {
  jsonl: 'JSON Lines (.jsonl)',
  json: 'JSON array (.json)',
  csv: 'CSV / TSV (.csv)',
  excel: 'Excel workbook (.xlsx)',
}

export const FORMAT_ICONS: Record<ImportFormat, typeof FileJson> = {
  jsonl: FileText,
  json: FileJson,
  csv: TableProperties,
  excel: FileSpreadsheet,
}

export const STRATEGY_LABELS: Record<DistributionStrategy, string> = {
  'open-queue': 'Open queue',
  'round-robin': 'Round robin',
  random: 'Random',
  'quota-by-annotator': 'Capacity quota',
}

export function deriveColumns(rows: ParsedRow[]): string[] {
  const keys = new Set<string>()
  for (const r of rows) {
    if (r.row && typeof r.row === 'object') {
      for (const k of Object.keys(r.row as Record<string, unknown>)) {
        keys.add(k)
      }
    }
  }
  return Array.from(keys).slice(0, 6)
}

export function renderCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function formatTemplateMode(mode: string): string {
  if (mode === 'pair-rubric') return 'Pair rubric'
  if (mode === 'arena-gsb') return 'Arena GSB'
  if (mode === 'custom-designer') return 'Custom Designer'
  if (mode === 'agent-trace-eval') return 'Agent trace'
  if (mode === 'rubric-judgment') return 'Rubric Judgment'
  return mode
}

export const ghostButtonStyle: CSSProperties = {
  minHeight: 40,
  color: 'var(--text)',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  textDecoration: 'none',
}
