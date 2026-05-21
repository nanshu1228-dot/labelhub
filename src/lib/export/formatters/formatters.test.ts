import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseCSV } from '@/lib/import/parsers/csv'
import { parseJSONL } from '@/lib/import/parsers/jsonl'
import { parseExcel } from '@/lib/import/parsers/excel'
import {
  formatCSV,
  formatExcel,
  formatJSON,
  formatJSONL,
  isExportFormat,
  pickFormatterFor,
} from './index'
import { projectRow, resolveDottedPath, type FieldMapping } from './types'

/**
 * Multi-format export tests — Finals P4 D15.
 *
 * Each formatter is exercised against:
 *   - identity mapping (every key passes through)
 *   - explicit mapping with dotted-path source resolution
 *   - json_stringify transform on nested values
 *
 * Round-trip: format → parse-back yields the same logical rows.
 * Verifies the formatter / parser pair are inverses for the common
 * shapes a labeler exports.
 */

async function* rowGen(rows: Record<string, unknown>[]) {
  for (const r of rows) yield r
}

async function collectChunks(
  iter: AsyncIterable<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const c of iter) {
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

async function asString(
  iter: AsyncIterable<Uint8Array>,
): Promise<string> {
  return new TextDecoder('utf-8').decode(await collectChunks(iter))
}

const SAMPLE_ROWS = [
  { id: '1', label: 'alpha', payload: { score: 80, notes: 'good' } },
  { id: '2', label: 'beta, with comma', payload: { score: 65, notes: 'meh' } },
  { id: '3', label: 'gamma', payload: { score: 92, notes: '' } },
]

describe('resolveDottedPath + projectRow', () => {
  it('walks nested paths', () => {
    expect(resolveDottedPath(SAMPLE_ROWS[0], 'payload.score')).toBe(80)
  })

  it('returns undefined for missing segments', () => {
    expect(resolveDottedPath(SAMPLE_ROWS[0], 'payload.gone')).toBeUndefined()
  })

  it('identity mapping returns the row as-is', () => {
    expect(projectRow(SAMPLE_ROWS[0], undefined)).toEqual(SAMPLE_ROWS[0])
  })

  it('applies mapping to extract + rename fields', () => {
    const mapping: FieldMapping[] = [
      { source: 'id', target: 'topic_id' },
      { source: 'payload.score', target: 'score' },
    ]
    expect(projectRow(SAMPLE_ROWS[0], mapping)).toEqual({
      topic_id: '1',
      score: 80,
    })
  })

  it('json_stringify transform coerces nested objects', () => {
    const mapping: FieldMapping[] = [
      { source: 'payload', target: 'payload_json', transform: 'json_stringify' },
    ]
    const r = projectRow(SAMPLE_ROWS[0], mapping)
    expect(typeof r.payload_json).toBe('string')
    expect(JSON.parse(r.payload_json as string)).toEqual({
      score: 80,
      notes: 'good',
    })
  })
})

describe('formatJSONL', () => {
  it('emits one JSON value per line + trailing newline', async () => {
    const text = await asString(formatJSONL(rowGen([{ a: 1 }, { a: 2 }])))
    expect(text).toBe(`{"a":1}\n{"a":2}\n`)
  })

  it('round-trips with parseJSONL', async () => {
    const buf = await collectChunks(formatJSONL(rowGen(SAMPLE_ROWS)))
    const back: unknown[] = []
    for await (const row of parseJSONL(buf)) {
      back.push(row.row)
    }
    expect(back).toEqual(SAMPLE_ROWS)
  })

  it('applies mapping per row', async () => {
    const text = await asString(
      formatJSONL(rowGen(SAMPLE_ROWS), {
        mapping: [
          { source: 'id', target: 'topic_id' },
          { source: 'payload.score', target: 'score' },
        ],
      }),
    )
    const lines = text.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toEqual([
      { topic_id: '1', score: 80 },
      { topic_id: '2', score: 65 },
      { topic_id: '3', score: 92 },
    ])
  })
})

describe('formatJSON', () => {
  it('emits a single JSON array', async () => {
    const text = await asString(formatJSON(rowGen([{ a: 1 }, { a: 2 }])))
    expect(text.trim()).toBe(`[{"a":1},{"a":2}]`)
  })

  it('handles an empty stream as []', async () => {
    const text = await asString(formatJSON(rowGen([])))
    expect(text.trim()).toBe('[]')
  })

  it('pretty mode adds newlines + indent', async () => {
    const text = await asString(
      formatJSON(rowGen([{ a: 1 }]), { pretty: true }),
    )
    expect(text).toContain('\n')
    // The output should be valid JSON.
    expect(JSON.parse(text)).toEqual([{ a: 1 }])
  })

  it('round-trips when the output is JSON.parsed', async () => {
    const text = await asString(formatJSON(rowGen(SAMPLE_ROWS)))
    expect(JSON.parse(text)).toEqual(SAMPLE_ROWS)
  })
})

describe('formatCSV', () => {
  it('emits header + rows from the first row keys when no mapping', async () => {
    const text = await asString(formatCSV(rowGen([{ a: 1, b: 'x' }, { a: 2, b: 'y' }])))
    expect(text).toBe(`a,b\n1,x\n2,y\n`)
  })

  it('quotes cells containing commas', async () => {
    const text = await asString(
      formatCSV(rowGen([{ id: '1', label: 'has, comma' }])),
    )
    expect(text).toContain(`"has, comma"`)
  })

  it('doubles quotes inside cells', async () => {
    const text = await asString(
      formatCSV(rowGen([{ id: '1', label: 'has "quote"' }])),
    )
    expect(text).toContain(`"has ""quote"""`)
  })

  it('defuses Excel formula injection', async () => {
    const text = await asString(
      formatCSV(rowGen([{ id: '1', cell: '=DANGEROUS()' }])),
    )
    // Output should NOT start the cell content with `=` once decoded by a CSV reader.
    expect(text).toContain(`"'=DANGEROUS()"`)
  })

  it('uses mapping for header order', async () => {
    const text = await asString(
      formatCSV(rowGen(SAMPLE_ROWS), {
        mapping: [
          { source: 'payload.score', target: 'score' },
          { source: 'id', target: 'topic_id' },
        ],
      }),
    )
    const lines = text.trim().split('\n')
    expect(lines[0]).toBe(`score,topic_id`)
  })

  it('round-trips with parseCSV', async () => {
    const text = await asString(formatCSV(rowGen([{ id: '1', label: 'x' }])))
    const back: unknown[] = []
    for await (const r of parseCSV(text)) back.push(r.row)
    expect(back).toEqual([{ id: '1', label: 'x' }])
  })

  it('stringifies non-primitives in cells', async () => {
    const text = await asString(
      formatCSV(rowGen([{ id: '1', payload: { a: 1 } }])),
    )
    // Cell with `{"a":1}` must be quoted because of the comma in the JSON repr.
    expect(text).toContain(`"{""a"":1}"`)
  })
})

describe('formatExcel', () => {
  it('produces a readable xlsx workbook', async () => {
    const buf = await collectChunks(formatExcel(rowGen(SAMPLE_ROWS)))
    // Sanity: parse the first sheet back with sheetjs and compare keys.
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const back = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: '',
    })
    expect(back.map((r) => r.id)).toEqual(['1', '2', '3'])
    expect(back[0].label).toBe('alpha')
  })

  it('round-trips with parseExcel when nested rows are stringified', async () => {
    const buf = await collectChunks(formatExcel(rowGen(SAMPLE_ROWS)))
    const back: unknown[] = []
    for await (const r of parseExcel(buf)) back.push(r.row)
    expect(back).toHaveLength(3)
    expect((back[0] as Record<string, unknown>).id).toBe('1')
  })

  it('uses the custom sheet name', async () => {
    const buf = await collectChunks(
      formatExcel(rowGen([{ a: 1 }]), { sheetName: 'My Sheet' }),
    )
    const wb = XLSX.read(buf, { type: 'array' })
    expect(wb.SheetNames).toEqual(['My Sheet'])
  })

  it('applies field mapping when set', async () => {
    const buf = await collectChunks(
      formatExcel(rowGen(SAMPLE_ROWS), {
        mapping: [
          { source: 'id', target: 'topic_id' },
          { source: 'payload.score', target: 'score' },
        ],
      }),
    )
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const headers = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
    })[0] as unknown[]
    expect(headers).toEqual(['topic_id', 'score'])
  })
})

describe('pickFormatterFor + isExportFormat', () => {
  it('returns the right formatter per format', () => {
    expect(pickFormatterFor('jsonl').meta.extension).toBe('jsonl')
    expect(pickFormatterFor('json').meta.extension).toBe('json')
    expect(pickFormatterFor('csv').meta.extension).toBe('csv')
    expect(pickFormatterFor('excel').meta.extension).toBe('xlsx')
  })

  it('content-types match the conventional MIME', () => {
    expect(pickFormatterFor('jsonl').meta.contentType).toMatch(/jsonl/)
    expect(pickFormatterFor('json').meta.contentType).toMatch(/json/)
    expect(pickFormatterFor('csv').meta.contentType).toMatch(/csv/)
    expect(pickFormatterFor('excel').meta.contentType).toMatch(/spreadsheet/)
  })

  it('isExportFormat narrows correctly', () => {
    expect(isExportFormat('csv')).toBe(true)
    expect(isExportFormat('xml')).toBe(false)
    expect(isExportFormat(null)).toBe(false)
  })
})
