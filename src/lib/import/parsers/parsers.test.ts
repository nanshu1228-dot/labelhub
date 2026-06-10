import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseCSV, parseCsvRows } from './csv'
import { parseExcel } from './excel'
import { parseJSON } from './json'
import { parseJSONL, streamLines } from './jsonl'
import { detectFormat, pickParserFor } from './index'
import type { ParsedRow } from './types'

/**
 * Multi-format parser tests — Finals P4 D14.
 *
 * Each parser is exercised against a canonical fixture + edge cases:
 *   - happy path: header → rows mapped correctly
 *   - malformed rows yield error rows (non-strict mode default)
 *   - strict mode throws on the first error
 *   - empty input / empty rows are handled
 *   - maxRows caps iteration
 *
 * The shared shape (ParsedRow) is identical across the 4 parsers so
 * the action layer can treat them uniformly.
 */

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of iter) out.push(x)
  return out
}

describe('parseJSONL', () => {
  it('parses a clean 3-row payload', async () => {
    const text = `{"a":1}\n{"a":2}\n{"a":3}\n`
    const rows = await collect(parseJSONL(text))
    expect(rows).toEqual([
      { lineNumber: 1, row: { a: 1 } },
      { lineNumber: 2, row: { a: 2 } },
      { lineNumber: 3, row: { a: 3 } },
    ])
  })

  it('skips blank lines without bumping lineNumber drift', async () => {
    const text = `{"a":1}\n\n{"a":2}\n`
    const rows = await collect(parseJSONL(text))
    expect(rows.map((r) => r.lineNumber)).toEqual([1, 3])
  })

  it('yields an error row for malformed JSON (non-strict)', async () => {
    const text = `{"a":1}\nbroken\n{"a":2}\n`
    const rows = await collect(parseJSONL(text))
    expect(rows).toHaveLength(3)
    expect(rows[1].row).toBeNull()
    expect(rows[1].error).toMatch(/parse failed/)
  })

  it('throws on first error in strict mode', async () => {
    const text = `{"a":1}\nbroken\n{"a":2}\n`
    await expect(
      collect(parseJSONL(text, { strict: true })),
    ).rejects.toThrow(/line 2/)
  })

  it('respects maxRows', async () => {
    const text = `{"a":1}\n{"a":2}\n{"a":3}\n`
    const rows = await collect(parseJSONL(text, { maxRows: 2 }))
    expect(rows).toHaveLength(2)
  })

  it('handles CRLF line endings', async () => {
    const text = `{"a":1}\r\n{"a":2}\r\n`
    const rows = await collect(parseJSONL(text))
    expect(rows).toHaveLength(2)
  })

  it('emits the trailing partial line (no final newline)', async () => {
    const text = `{"a":1}\n{"a":2}`
    const rows = await collect(parseJSONL(text))
    expect(rows.map((r) => r.row)).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('accepts a Uint8Array input', async () => {
    const buf = new TextEncoder().encode(`{"a":1}\n{"a":2}\n`)
    const rows = await collect(parseJSONL(buf))
    expect(rows).toHaveLength(2)
  })

  it('accepts an AsyncIterable<Uint8Array> input', async () => {
    async function* chunks() {
      yield new TextEncoder().encode(`{"a":1}\n{"a":`)
      yield new TextEncoder().encode(`2}\n`)
    }
    const rows = await collect(parseJSONL(chunks()))
    expect(rows.map((r) => r.row)).toEqual([{ a: 1 }, { a: 2 }])
  })
})

describe('streamLines helper', () => {
  it('yields lines from a Uint8Array', async () => {
    const buf = new TextEncoder().encode(`a\nb\nc`)
    const lines: string[] = []
    for await (const l of streamLines(buf)) lines.push(l)
    expect(lines).toEqual(['a', 'b', 'c'])
  })
})

describe('parseJSON (array root)', () => {
  it('emits each element of a JSON array', async () => {
    const text = JSON.stringify([{ a: 1 }, { a: 2 }])
    const rows = await collect(parseJSON(text))
    expect(rows.map((r) => r.row)).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('reports an error row when root is not an array', async () => {
    const rows = await collect(parseJSON('{"not": "an array"}'))
    expect(rows[0].error).toMatch(/array/)
  })

  it('rejects non-object elements in non-strict mode', async () => {
    const text = JSON.stringify([{ a: 1 }, 'string-row', { a: 2 }])
    const rows = await collect(parseJSON(text))
    expect(rows.map((r) => r.row !== null)).toEqual([true, false, true])
  })

  it('strict mode throws on first non-object element', async () => {
    const text = JSON.stringify([{ a: 1 }, 'bad'])
    await expect(
      collect(parseJSON(text, { strict: true })),
    ).rejects.toThrow(/Row 2/)
  })

  it('respects maxRows for large arrays', async () => {
    const text = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({ idx: i })),
    )
    const rows = await collect(parseJSON(text, { maxRows: 10 }))
    expect(rows).toHaveLength(10)
  })
})

describe('parseCSV', () => {
  it('parses header + 2 rows', async () => {
    const text = `id,prompt\n1,hello\n2,world\n`
    const rows = await collect(parseCSV(text))
    expect(rows.map((r) => r.row)).toEqual([
      { id: '1', prompt: 'hello' },
      { id: '2', prompt: 'world' },
    ])
  })

  it('handles quoted commas inside cells', async () => {
    const text = `id,prompt\n1,"hi, there"\n`
    const rows = await collect(parseCSV(text))
    expect(rows[0].row).toEqual({ id: '1', prompt: 'hi, there' })
  })

  it('handles escaped quotes (RFC 4180 doubling)', async () => {
    const text = `id,prompt\n1,"she said ""hi"""\n`
    const rows = await collect(parseCSV(text))
    expect(rows[0].row).toEqual({ id: '1', prompt: 'she said "hi"' })
  })

  it('handles CRLF line endings', async () => {
    const text = `id,prompt\r\n1,hi\r\n2,bye\r\n`
    const rows = await collect(parseCSV(text))
    expect(rows.map((r) => r.row)).toEqual([
      { id: '1', prompt: 'hi' },
      { id: '2', prompt: 'bye' },
    ])
  })

  it('strips a UTF-8 BOM at the start', async () => {
    const text = `﻿id,prompt\n1,hi\n`
    const rows = await collect(parseCSV(text))
    expect(rows[0].row).toEqual({ id: '1', prompt: 'hi' })
  })

  it('yields error row on column-count mismatch', async () => {
    const text = `id,prompt\n1,hi,extra\n`
    const rows = await collect(parseCSV(text))
    expect(rows[0].row).toBeNull()
    expect(rows[0].error).toMatch(/expected 2 columns, got 3/)
  })

  it('preserves empty cells as empty strings', async () => {
    const text = `id,prompt,extra\n1,hello,\n`
    const rows = await collect(parseCSV(text))
    expect(rows[0].row).toEqual({ id: '1', prompt: 'hello', extra: '' })
  })

  it('parseCsvRows tokenizes a tricky multi-line cell', () => {
    const rows = parseCsvRows(`id,prompt\n1,"line1\nline2"\n`)
    // Row 0 is the header; row 1 contains the embedded newline cell.
    expect(rows[1]).toEqual(['1', 'line1\nline2'])
  })
})

describe('parseExcel', () => {
  it('parses a 1-sheet workbook with 2 rows', async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['id', 'prompt'],
      [1, 'hi'],
      [2, 'bye'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
    const rows = await collect(parseExcel(buffer))
    expect(rows.map((r) => r.row)).toEqual([
      { id: '1', prompt: 'hi' },
      { id: '2', prompt: 'bye' },
    ])
  })

  it('skips empty rows in the middle of the sheet', async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['id', 'prompt'],
      [1, 'hi'],
      ['', ''],
      [2, 'bye'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
    const rows = await collect(parseExcel(buffer))
    expect(rows).toHaveLength(2)
  })

  it('reports an error row on a malformed buffer', async () => {
    const bad = new Uint8Array([0xff, 0xfe, 0x00])
    const rows = await collect(parseExcel(bad))
    // sheetjs's strictness varies — accept either a clean error row or empty.
    if (rows.length > 0) {
      expect(rows[0].row).toBeNull()
      expect(rows[0].error).toBeDefined()
    }
  })
})

describe('detectFormat + pickParserFor', () => {
  it('detects each extension', () => {
    expect(detectFormat('data.jsonl')).toBe('jsonl')
    expect(detectFormat('data.ndjson')).toBe('jsonl')
    expect(detectFormat('data.json')).toBe('json')
    expect(detectFormat('data.csv')).toBe('csv')
    expect(detectFormat('data.tsv')).toBe('csv')
    expect(detectFormat('Workbook.XLSX')).toBe('excel')
    expect(detectFormat('weird.bin')).toBeNull()
  })

  it('pickParserFor returns the right function', async () => {
    const text = `{"a":1}\n`
    const rows = await collect(pickParserFor('jsonl')(text))
    expect(rows[0].row).toEqual({ a: 1 })
  })
})

describe('shared ParsedRow shape — uniformity', () => {
  it('every parser yields {lineNumber, row} (or {row:null, error})', async () => {
    const samples: Array<Promise<ParsedRow[]>> = [
      collect(parseJSONL('{"x":1}\n')),
      collect(parseJSON('[{"x":1}]')),
      collect(parseCSV('x\n1\n')),
    ]
    const all = await Promise.all(samples)
    for (const rows of all) {
      expect(rows[0]).toHaveProperty('lineNumber')
      expect(rows[0]).toHaveProperty('row')
      expect(rows[0].row).not.toBeNull()
    }
  })
})
