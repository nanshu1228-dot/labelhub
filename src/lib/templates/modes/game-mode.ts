import { z } from 'zod'
import type { PlatformTemplate } from '../types'
import { registerTemplate } from '../registry'

/**
 * Game Mode — daily challenges, leagues, streaks. Annotation as practice.
 * Scoring is single-Likert per item so the work is fast (daily-driver friendly).
 */

const itemSchema = z.object({
  prompt: z.string().min(1),
  modelResponse: z.string().min(1),
})

const responseSchema = z.object({
  score: z.number().int().min(1).max(5),
  /** Optional one-tap reason chips: ['factual', 'helpful', 'safe', 'concise'] etc */
  tags: z.array(z.string()).max(8).optional(),
  /** Single-line reason; required so we get reasoning signal even in fast mode */
  reasoning: z.string().min(1).max(280),
})

export const gameModeTemplate: PlatformTemplate = {
  mode: 'game-mode',
  name: 'Game Mode',
  description: 'Daily challenges, leagues, streaks. Annotation as practice.',
  itemSchema,
  responseSchema,
  workflow: ['drafting', 'submitted', 'approved'],
  perfBudget: {
    maxItemsPerCell: 20,
    virtualizationRequired: false,
    atomicStateRequired: false,
    autoSavePolicy: 'on-submit',
  },
  economy: { type: 'rating-elo', currency: 'XP' },
  ui: { theme: 'game', layout: 'single-column' },
}

registerTemplate(gameModeTemplate)
