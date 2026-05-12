import { z } from 'zod'
import type { PlatformTemplate } from '../types'
import { registerTemplate } from '../registry'

/**
 * Classic Survey — Xpert-style.
 *
 * Item = one prompt + N model responses.
 * Response = annotator-authored rubrics, each rubric voted pass/fail per model.
 *
 * This is the template that died at 50 rubrics on prior platforms.
 * Here `maxItemsPerCell: 1000` is allowed, but virtualization + atomic state are
 * mandated by the registry — the engine refuses to ship the failure mode.
 */

const modelResponseSchema = z.object({
  modelName: z.string(),
  content: z.string(),
})

const rubricSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  /** modelName → pass(true)/fail(false). All keys must match itemData.modelResponses. */
  modelScores: z.record(z.string(), z.boolean()),
})

const itemSchema = z.object({
  prompt: z.string().min(1),
  modelResponses: z.array(modelResponseSchema).min(2),
})

const responseSchema = z.object({
  rubrics: z.array(rubricSchema).max(2000),
  overallNotes: z.string().max(2000).optional(),
})

export const classicSurveyTemplate: PlatformTemplate = {
  mode: 'classic-survey',
  name: 'Classic Survey',
  description:
    'Prompt + multi-model responses + self-authored rubric scoring (Xpert-style, ByteDance-proven).',
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
    type: 'cash-per-item',
    currency: 'CNY',
    qualityMultiplierMin: 1.0,
    qualityMultiplierMax: 1.5,
  },
  ui: {
    theme: 'classic',
    layout: 'split-screen',
  },
}

registerTemplate(classicSurveyTemplate)
