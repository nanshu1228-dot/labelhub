/**
 * JSONL formatter — Finals P4 D15.
 *
 * Default streaming format. One JSON value per line, no surrounding
 * array. Mirror of the existing /export route's body (so the new
 * `format=jsonl` is just a label confirming the default).
 */

import { projectRow, type RowFormatter } from './types'

const TE = new TextEncoder()

export const formatJSONL: RowFormatter = async function* (rows, opts = {}) {
  for await (const row of rows) {
    const projected = projectRow(row, opts.mapping)
    const line = opts.pretty
      ? JSON.stringify(projected, null, 2)
      : JSON.stringify(projected)
    yield TE.encode(line + '\n')
  }
}

formatJSONL.meta = {
  contentType: 'application/jsonl',
  extension: 'jsonl',
}
