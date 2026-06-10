/**
 * Import parser surface — Finals P4 D14.
 *
 * Every parser (json / jsonl / csv / excel) yields the SAME shape so
 * the Task Import UI + `createTopicsBatch` action can treat them
 * uniformly. Per-row errors land alongside successful rows so a single
 * malformed line never aborts the batch (spec 4.1: partial-success
 * report with row-level errors).
 *
 *   AsyncIterable<ParsedRow> →
 *     { row: validatedTopicShape, lineNumber: N }    on success
 *     { row: null, lineNumber: N, error: 'reason' }  on parse failure
 *
 * The validated topic shape is intentionally `unknown` here — the
 * action layer projects it onto the `topics` Drizzle schema with
 * Zod, surfacing per-row Zod errors back through the same channel.
 *
 * AsyncIterable<> chosen over a flat array so 1000-row imports
 * stream row-by-row instead of materializing the whole payload. The
 * Excel parser is the only one that buffers the workbook (sheetjs
 * doesn't stream); even so its memory footprint is bounded by the
 * 50MB upload cap enforced upstream.
 */

export interface ParsedRow {
  /** 1-indexed source line / sheet row for error attribution. */
  lineNumber: number
  /** Parsed cells / object body. null when the line failed to parse. */
  row: unknown | null
  /** Reason — present only when `row` is null. */
  error?: string
}

export interface ParserOptions {
  /**
   * Max rows to emit before bailing out. Keeps a runaway file from
   * pinning memory or pumping millions of rows into the per-row
   * validator. Defaults to 100k — enough for realistic batches
   * (D14's gate is "1000-row JSONL + 500-row Excel"). Set to
   * Number.POSITIVE_INFINITY to disable.
   */
  maxRows?: number
  /**
   * Strict mode — when true, ANY parse error throws instead of
   * yielding an error row. Used by the API path that wants to
   * validate the entire payload before committing. The UI path
   * leaves strict=false so the reviewer sees the row-level errors.
   */
  strict?: boolean
}

export const DEFAULT_MAX_ROWS = 100_000

export type RowParser = (
  input: AsyncIterable<Uint8Array> | string | Uint8Array,
  opts?: ParserOptions,
) => AsyncIterable<ParsedRow>
