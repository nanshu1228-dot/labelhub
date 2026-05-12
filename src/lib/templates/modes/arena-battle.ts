import { z } from 'zod'
import type { PlatformTemplate } from '../types'
import { registerTemplate } from '../registry'

/**
 * Arena Battle — LMSYS-style two-model head-to-head.
 * Annotator picks a winner and writes a one-line reason.
 * Rubric infers itself from accumulated reasons.
 */

const itemSchema = z.object({
  prompt: z.string().min(1),
  responseA: z.object({ modelName: z.string(), content: z.string() }),
  responseB: z.object({ modelName: z.string(), content: z.string() }),
})

const responseSchema = z.object({
  winner: z.enum(['a', 'b', 'tie']),
  reasoning: z.string().min(1, 'Reason is required — that is the data we capture.'),
})

export const arenaBattleTemplate: PlatformTemplate = {
  mode: 'arena-battle',
  name: 'Arena Battle',
  description:
    'LMSYS-style head-to-head. Pick a winner, write a one-line reason — the rubric infers itself.',
  itemSchema,
  responseSchema,
  workflow: ['drafting', 'submitted', 'approved'],
  perfBudget: {
    maxItemsPerCell: 30,
    virtualizationRequired: false,
    atomicStateRequired: false,
    autoSavePolicy: 'on-submit',
  },
  economy: { type: 'rating-elo' },
  ui: { theme: 'cyberpunk', layout: 'split-screen' },
}

registerTemplate(arenaBattleTemplate)
