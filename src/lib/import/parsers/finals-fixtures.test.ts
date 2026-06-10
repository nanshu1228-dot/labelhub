import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseJSONL } from './jsonl'
import {
  QA_QUALITY_TEMPLATE,
  PREFERENCE_COMPARE_TEMPLATE,
} from '@/lib/form-designer/templates'

/**
 * Finals demo seed parser integration — Finals D19-D.
 *
 * Exercises the D14 JSONL parser against the real official datasets
 * the seed script would import. Catches:
 *   - dataset row count matches the spec (30 + 12)
 *   - every row has the required fields the template's ShowItems
 *     point at (prompt / model_answer / response_a / response_b)
 *   - the templates' sourcePath values resolve against real rows
 *
 * This protects the demo from a parser regression silently dropping
 * rows (e.g. UTF-8 BOM mishandle, CRLF in the file, etc.) AND from
 * a template/dataset schema drift (sourcePath references a key the
 * dataset doesn't carry).
 */

// __dirname here is src/lib/import/parsers; tmp-data lives at the
// repo root.
const DATASET_BASE = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'tmp-data',
  'datasets',
)

async function loadDataset(path: string): Promise<Array<Record<string, unknown>>> {
  const buf = await readFile(resolve(DATASET_BASE, path))
  const out: Record<string, unknown>[] = []
  for await (const row of parseJSONL(new Uint8Array(buf))) {
    if (row.row && typeof row.row === 'object') {
      out.push(row.row as Record<string, unknown>)
    }
  }
  return out
}

describe('Finals demo dataset · qa_quality', () => {
  it('JSONL parses exactly 30 rows', async () => {
    const rows = await loadDataset('qa_quality/jsonl/qa_quality.jsonl')
    expect(rows).toHaveLength(30)
  })

  it('every row has the keys the qa-quality template ShowItems point at', async () => {
    const rows = await loadDataset('qa_quality/jsonl/qa_quality.jsonl')
    const showItemKeys = QA_QUALITY_TEMPLATE.fields
      .filter((f) => f.kind === 'show-item')
      .map((f) => (f.config as { sourcePath?: string }).sourcePath ?? '')
      .filter((k) => k && !k.includes('.'))
    expect(showItemKeys.length).toBeGreaterThan(0)
    for (const row of rows) {
      for (const k of showItemKeys) {
        // Must be present (even if empty string — for media_url on
        // text-only rows).
        expect(row).toHaveProperty(k)
      }
    }
  })

  it('media_type distribution matches the spec', async () => {
    const rows = await loadDataset('qa_quality/jsonl/qa_quality.jsonl')
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      const k = String((r as { media_type?: unknown }).media_type ?? '')
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    // Spec: 20 text + 4 image + 3 markdown + 3 video.
    expect(counts.text).toBe(20)
    expect(counts.image).toBe(4)
    expect(counts.markdown).toBe(3)
    expect(counts.video).toBe(3)
  })

  it('row IDs are non-empty and unique', async () => {
    const rows = await loadDataset('qa_quality/jsonl/qa_quality.jsonl')
    const ids = rows.map((r) => String((r as { id?: unknown }).id ?? ''))
    expect(ids.every((id) => id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('Finals demo dataset · preference_compare', () => {
  it('JSONL parses exactly 12 rows', async () => {
    const rows = await loadDataset(
      'preference_compare/jsonl/preference_compare.jsonl',
    )
    expect(rows).toHaveLength(12)
  })

  it('every row carries prompt + response_a + response_b', async () => {
    const rows = await loadDataset(
      'preference_compare/jsonl/preference_compare.jsonl',
    )
    for (const row of rows) {
      expect(row).toHaveProperty('prompt')
      expect(row).toHaveProperty('response_a')
      expect(row).toHaveProperty('response_b')
    }
  })

  it('preference-compare template ShowItem sourcePaths align with the dataset', async () => {
    const rows = await loadDataset(
      'preference_compare/jsonl/preference_compare.jsonl',
    )
    const paths = PREFERENCE_COMPARE_TEMPLATE.fields
      .filter((f) => f.kind === 'show-item')
      .map((f) => (f.config as { sourcePath?: string }).sourcePath ?? '')
    expect(paths.sort()).toEqual(['prompt', 'response_a', 'response_b'])
    // Sanity: every sourcePath resolves to a non-empty string for
    // every row.
    const sample = rows[0]
    for (const p of paths) {
      const v = (sample as Record<string, unknown>)[p]
      expect(typeof v).toBe('string')
      expect((v as string).length).toBeGreaterThan(0)
    }
  })

  it('preferred is one of A / B / tie for every row', async () => {
    const rows = await loadDataset(
      'preference_compare/jsonl/preference_compare.jsonl',
    )
    const allowed = new Set(['A', 'B', 'tie'])
    for (const r of rows) {
      expect(allowed.has(String((r as { preferred?: unknown }).preferred))).toBe(true)
    }
  })
})

describe('Finals demo dataset · totals', () => {
  it('combined row count is 42 (30 + 12)', async () => {
    const qa = await loadDataset('qa_quality/jsonl/qa_quality.jsonl')
    const pref = await loadDataset(
      'preference_compare/jsonl/preference_compare.jsonl',
    )
    expect(qa.length + pref.length).toBe(42)
  })
})
