/**
 * Export formatter surface — Finals P4 D15.
 *
 * Mirror of the import-parser side: every formatter accepts an
 * AsyncIterable of row records + an optional field-mapping config,
 * and yields an AsyncIterable<Uint8Array> ready to pump into a
 * Response body. The four formats (JSON / JSONL / CSV / Excel) all
 * implement this contract so the API route picks one based on the
 * `?format=` query param.
 *
 * Field mapping:
 *   - source: dotted path into the row object (e.g. `payload.answer`)
 *   - target: output column name (CSV/Excel) or output property
 *             name (JSON / JSONL)
 *   - transform: 'json_stringify' coerces non-string values into
 *                their JSON encoding (useful when a JSON-typed field
 *                lands in a CSV cell)
 *
 * Empty mapping = identity (every top-level key of the row passes
 * through unchanged). Convenient for the existing /export path that
 * pumps verbatim manifest entries.
 */

export interface FieldMapping {
  source: string
  target: string
  transform?: 'json_stringify' | 'identity'
}

export interface FormatOptions {
  /** Per-row field projection. Empty / undefined = identity. */
  mapping?: FieldMapping[]
  /** Pretty-print for JSON / JSONL (default false). */
  pretty?: boolean
  /** Excel sheet name (default 'Sheet1'). */
  sheetName?: string
}

export interface FormatterMetadata {
  /** Content-type the API route should set on the Response. */
  contentType: string
  /** Conventional file extension (without the leading dot). */
  extension: string
}

export type RowFormatter = {
  (
    rows: AsyncIterable<Record<string, unknown>>,
    opts?: FormatOptions,
  ): AsyncIterable<Uint8Array>
  meta: FormatterMetadata
}

/**
 * Resolve a dotted path against a row. Returns undefined for any
 * missing segment so the projection helper can decide between
 * "skip" and "emit null".
 *
 * Identical semantics to the show-item runtime helper, with a
 * shorter contract.
 */
export function resolveDottedPath(
  source: unknown,
  path: string,
): unknown {
  if (!path) return source
  const parts = path.split('.')
  let cur: unknown = source
  for (const p of parts) {
    if (cur && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return cur
}

/**
 * Apply a field mapping to a single row. Returns a fresh object
 * keyed by `target` names. When `mapping` is empty, the row is
 * returned as-is (identity).
 */
export function projectRow(
  row: Record<string, unknown>,
  mapping: FieldMapping[] | undefined,
): Record<string, unknown> {
  if (!mapping || mapping.length === 0) return row
  const out: Record<string, unknown> = {}
  for (const m of mapping) {
    const raw = resolveDottedPath(row, m.source)
    out[m.target] = m.transform === 'json_stringify'
      ? coerceToString(raw)
      : raw ?? null
  }
  return out
}

function coerceToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
