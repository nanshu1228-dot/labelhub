import type { FormSchema } from '@/lib/form-designer/schema'

export const DESIGNER_HISTORY_LIMIT = 20

export interface DesignerHistory {
  past: FormSchema[]
  future: FormSchema[]
}

export const EMPTY_DESIGNER_HISTORY: DesignerHistory = {
  past: [],
  future: [],
}

export function schemasEqual(a: FormSchema, b: FormSchema): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function pushDesignerHistory(
  history: DesignerHistory,
  current: FormSchema,
  next: FormSchema,
  limit = DESIGNER_HISTORY_LIMIT,
): DesignerHistory {
  if (schemasEqual(current, next)) return history
  return {
    past: [...history.past.slice(-(limit - 1)), current],
    future: [],
  }
}

export function undoDesignerHistory(
  history: DesignerHistory,
  current: FormSchema,
): { history: DesignerHistory; schema: FormSchema } | null {
  const previous = history.past.at(-1)
  if (!previous) return null
  return {
    schema: previous,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future].slice(0, DESIGNER_HISTORY_LIMIT),
    },
  }
}

export function redoDesignerHistory(
  history: DesignerHistory,
  current: FormSchema,
): { history: DesignerHistory; schema: FormSchema } | null {
  const next = history.future[0]
  if (!next) return null
  return {
    schema: next,
    history: {
      past: [...history.past.slice(-(DESIGNER_HISTORY_LIMIT - 1)), current],
      future: history.future.slice(1),
    },
  }
}
