import { z } from 'zod'
import type { PlatformTemplate } from '../types'
import { registerTemplate } from '../registry'

/**
 * Token Economy — classic-survey rubric work with an LBH token reward layer.
 * Annotators stake reputation; quality scales the reward multiplier.
 */

const modelResponseSchema = z.object({
  modelName: z.string(),
  content: z.string(),
})

const rubricSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  modelScores: z.record(z.string(), z.boolean()),
})

const itemSchema = z.object({
  prompt: z.string().min(1),
  modelResponses: z.array(modelResponseSchema).min(2),
})

const responseSchema = z.object({
  rubrics: z.array(rubricSchema).max(2000),
  stakeAmount: z.number().nonnegative().default(0),
  notes: z.string().max(2000).optional(),
})

export const tokenEconomyTemplate: PlatformTemplate = {
  mode: 'token-economy',
  name: 'Token Economy',
  description: 'Stake reputation, earn LBH. Quality scales the multiplier.',
  itemSchema,
  responseSchema,
  workflow: ['drafting', 'submitted', 'reviewing', 'approved', 'rejected'],
  perfBudget: {
    maxItemsPerCell: 1000,
    virtualizationRequired: true,
    atomicStateRequired: true,
    autoSavePolicy: 'debounce-500ms',
    maxResponseLengthChars: 50000,
  },
  economy: {
    type: 'token',
    currency: 'LBH',
    qualityMultiplierMin: 1.0,
    qualityMultiplierMax: 3.0,
  },
  ui: { theme: 'web3', layout: 'wallet-first' },
}

registerTemplate(tokenEconomyTemplate)
