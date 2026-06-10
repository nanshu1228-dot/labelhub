/**
 * Per-format export validation — M1.
 *
 * A small, pure pre-flight check run BEFORE any bytes are written or
 * streamed. The goal is fail-fast: if the assembled rows can't be
 * encoded cleanly into the chosen format, throw a typed error naming
 * the offending row + field instead of emitting a corrupt file.
 *
 * The four formats have different well-formedness requirements:
 *
 *   - JSON  — the whole collection must serialize as a valid array, so
 *             every (projected) row must `JSON.stringify` without
 *             throwing.
 *   - JSONL — each row is one independent line, so each row must
 *             `JSON.stringify` without throwing.
 *   - CSV / Excel — rows are flattened into scalar cells. The
 *             formatters JSON-stringify nested objects/arrays into a
 *             cell (that round-trips), so nesting itself is allowed.
 *             What is NOT representable is a value that can't be
 *             coerced to a string at all (circular structures,
 *             BigInt, functions, symbols) — those would silently drop
 *             or throw mid-write and corrupt the sheet.
 *
 * Validation runs against the SAME projection the formatter applies
 * (via `projectRow`) so a field-mapping that flattens nested data
 * (e.g. `transform: json_stringify`) is honored and not falsely
 * rejected.
 *
 * Behavior-preserving: every value that the existing formatters
 * already encode without error passes this check unchanged.
 */

import { ValidationError } from '@/lib/errors'
import type { ExportFormat } from './formatters'
import { projectRow, type FieldMapping } from './formatters/types'

/**
 * Typed error for export validation failures. Subclasses the shared
 * `ValidationError` (code VALIDATION_ERROR, HTTP 400) so existing
 * Route Handler / Server Action error handling surfaces it correctly,
 * while carrying structured row/field context for diagnostics.
 */
export class ExportValidationError extends ValidationError {
  /** Zero-based index of the offending row, when known. */
  readonly rowIndex?: number
  /** Offending field / column name, when known. */
  readonly field?: string
  /** The format the rows were being validated for. */
  readonly format: ExportFormat

  constructor(
    message: string,
    detail: { format: ExportFormat; rowIndex?: number; field?: string },
  ) {
    super(message)
    this.format = detail.format
    this.rowIndex = detail.rowIndex
    this.field = detail.field
  }
}

export interface ValidateRowsOptions {
  /** Same field mapping the formatter will apply (default: identity). */
  mapping?: FieldMapping[]
}

/**
 * Validate that `rows` are well-formed for `format`. Throws an
 * {@link ExportValidationError} on the first problem; returns void on
 * success. Pure (no IO) and synchronous so it can run as a cheap
 * pre-flight gate in front of the streaming formatter.
 */
export function validateRowsForFormat(
  rows: ReadonlyArray<Record<string, unknown>>,
  format: ExportFormat,
  opts: ValidateRowsOptions = {},
): void {
  const mapping = opts.mapping
  for (let i = 0; i < rows.length; i++) {
    const projected = projectRow(rows[i], mapping)
    if (format === 'json' || format === 'jsonl') {
      assertSerializable(projected, i, format)
    } else {
      // csv | excel — every cell must coerce to a scalar string.
      for (const [field, value] of Object.entries(projected)) {
        assertCellRepresentable(value, i, field, format)
      }
    }
  }
}

/**
 * A whole row must JSON-serialize for the JSON / JSONL encodings.
 * `JSON.stringify` throws on circular references and BigInt — both
 * would otherwise abort the stream mid-write and leave a truncated,
 * unparseable file.
 */
function assertSerializable(
  row: Record<string, unknown>,
  rowIndex: number,
  format: ExportFormat,
): void {
  let serialized: string
  try {
    serialized = JSON.stringify(row)
  } catch (e) {
    throw new ExportValidationError(
      `Row ${rowIndex} cannot be serialized to ${format.toUpperCase()}: ${
        e instanceof Error ? e.message : 'not JSON-serializable'
      }.`,
      { format, rowIndex },
    )
  }
  // A row that serializes to `undefined` (e.g. a bare function/symbol
  // sneaking past projection) is not a valid JSON value for either a
  // JSONL line or a JSON-array element.
  if (serialized === undefined) {
    throw new ExportValidationError(
      `Row ${rowIndex} produced no valid JSON value for ${format.toUpperCase()}.`,
      { format, rowIndex },
    )
  }
}

/**
 * A CSV / Excel cell must be representable as a scalar string. The
 * formatters accept strings, numbers, booleans, null/undefined (empty
 * cell), and JSON-stringify nested objects/arrays. The only values
 * that cannot be put in a cell are ones that don't serialize at all:
 *   - functions / symbols (JSON.stringify → undefined, silently lost)
 *   - bigint (JSON.stringify throws)
 *   - circular objects (JSON.stringify throws)
 */
function assertCellRepresentable(
  value: unknown,
  rowIndex: number,
  field: string,
  format: ExportFormat,
): void {
  if (value === null || value === undefined) return
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return

  if (t === 'bigint') {
    throw new ExportValidationError(
      `Row ${rowIndex}, field "${field}" is a BigInt, which cannot be written to a ${format.toUpperCase()} cell. Map it through a string transform first.`,
      { format, rowIndex, field },
    )
  }
  if (t === 'function' || t === 'symbol') {
    throw new ExportValidationError(
      `Row ${rowIndex}, field "${field}" is a ${t}, which has no ${format.toUpperCase()} cell representation.`,
      { format, rowIndex, field },
    )
  }

  // object / array — allowed, but only if it flattens to a JSON string
  // (the formatters JSON.stringify it into the cell). Reject anything
  // that can't be stringified (circular reference, embedded BigInt).
  try {
    const s = JSON.stringify(value)
    if (s === undefined) {
      throw new ExportValidationError(
        `Row ${rowIndex}, field "${field}" has no ${format.toUpperCase()} cell representation.`,
        { format, rowIndex, field },
      )
    }
  } catch (e) {
    if (e instanceof ExportValidationError) throw e
    throw new ExportValidationError(
      `Row ${rowIndex}, field "${field}" cannot be flattened into a ${format.toUpperCase()} cell: ${
        e instanceof Error ? e.message : 'not serializable'
      }.`,
      { format, rowIndex, field },
    )
  }
}
