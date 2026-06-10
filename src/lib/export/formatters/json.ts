/**
 * JSON-array formatter — Finals P4 D15.
 *
 * Streams a single JSON array. Buffers commas between rows so the
 * client can stream-parse the result. NOT identical to "stringify
 * the whole list" — that path materializes; this path keeps memory
 * bounded.
 */

import { projectRow, type RowFormatter } from './types'

const TE = new TextEncoder()

export const formatJSON: RowFormatter = async function* (rows, opts = {}) {
  yield TE.encode('[')
  let first = true
  for await (const row of rows) {
    const projected = projectRow(row, opts.mapping)
    const line = opts.pretty
      ? JSON.stringify(projected, null, 2)
      : JSON.stringify(projected)
    if (first) {
      yield TE.encode(opts.pretty ? '\n' + line : line)
      first = false
    } else {
      yield TE.encode(opts.pretty ? ',\n' + line : ',' + line)
    }
  }
  yield TE.encode(opts.pretty && !first ? '\n]\n' : ']\n')
}

formatJSON.meta = {
  contentType: 'application/json',
  extension: 'json',
}
