import { z } from 'zod'
import type { PlatformTemplate } from '../types'
import { registerTemplate } from '../registry'

/**
 * Apprentice Mode — a personalized AI partner that learns the annotator's
 * judgment over time. Each session writes back rules the apprentice infers
 * from your edits, surfaced on subsequent items.
 */

const itemSchema = z.object({
  prompt: z.string().min(1),
  context: z.string().optional(),
})

const responseSchema = z.object({
  /** Apprentice's draft (filled by AI on item open) */
  apprenticeProposal: z.string(),
  apprenticeConfidence: z.number().min(0).max(1),
  apprenticeRules: z.array(z.string()).optional(), // rules the apprentice cites
  /** Human-driven */
  humanFinal: z.string().min(1),
  humanReasoning: z.string().min(1),
  /** Rules the human teaches the apprentice this round */
  newRules: z.array(z.string()).max(20).optional(),
})

export const apprenticeModeTemplate: PlatformTemplate = {
  mode: 'apprentice-mode',
  name: 'Apprentice Mode',
  description: 'A personal AI partner that learns your judgment over time.',
  itemSchema,
  responseSchema,
  workflow: ['drafting', 'submitted', 'approved'],
  perfBudget: {
    maxItemsPerCell: 100,
    virtualizationRequired: true,
    atomicStateRequired: true,
    autoSavePolicy: 'on-blur',
    maxResponseLengthChars: 20000,
  },
  economy: {
    type: 'cash-per-item',
    currency: 'CNY',
    qualityMultiplierMin: 1.0,
    qualityMultiplierMax: 2.0,
  },
  ui: { theme: 'minimal', layout: 'sidebar-detail' },
}

registerTemplate(apprenticeModeTemplate)
