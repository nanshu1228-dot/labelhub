import { describe, expect, it } from 'vitest'
import {
  DESIGNER_HISTORY_LIMIT,
  EMPTY_DESIGNER_HISTORY,
  pushDesignerHistory,
  redoDesignerHistory,
  undoDesignerHistory,
} from './history'
import type { FormSchema } from '@/lib/form-designer/schema'

function schema(id: string): FormSchema {
  return {
    version: 1,
    fields: [
      {
        id,
        kind: 'text',
        label: id,
        config: {},
        validation: [],
      },
    ],
  }
}

describe('Designer history', () => {
  it('pushes undo snapshots and clears redo history', () => {
    const a = schema('a')
    const b = schema('b')
    const c = schema('c')
    const history = pushDesignerHistory(
      { past: [a], future: [c] },
      b,
      c,
    )

    expect(history.past).toEqual([a, b])
    expect(history.future).toEqual([])
  })

  it('ignores equivalent schemas', () => {
    const a = schema('a')
    const history = pushDesignerHistory(EMPTY_DESIGNER_HISTORY, a, a)
    expect(history).toBe(EMPTY_DESIGNER_HISTORY)
  })

  it('undoes and redoes a canvas change', () => {
    const a = schema('a')
    const b = schema('b')
    const history = pushDesignerHistory(EMPTY_DESIGNER_HISTORY, a, b)
    const undone = undoDesignerHistory(history, b)

    expect(undone?.schema).toEqual(a)
    expect(undone?.history.future).toEqual([b])

    const redone = redoDesignerHistory(undone!.history, undone!.schema)
    expect(redone?.schema).toEqual(b)
    expect(redone?.history.past).toEqual([a])
  })

  it('caps history at the configured limit', () => {
    let history = EMPTY_DESIGNER_HISTORY
    let current = schema('0')
    for (let i = 1; i <= DESIGNER_HISTORY_LIMIT + 5; i++) {
      const next = schema(String(i))
      history = pushDesignerHistory(history, current, next)
      current = next
    }

    expect(history.past).toHaveLength(DESIGNER_HISTORY_LIMIT)
    expect(history.past[0].fields[0].id).toBe('5')
  })
})
