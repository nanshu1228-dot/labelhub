import { z } from 'zod'
import type { PlatformTemplate } from '../types'
import { registerTemplate } from '../registry'

/**
 * Pair Annotation — Innovation #1.
 *
 * Claude proposes an initial answer with confidence + reasoning.
 * Human accepts (1-click), edits (with reasoning), or rejects (with reasoning).
 * The delta (claudeProposal → humanFinal) is captured as the "Teaching Signal" —
 * higher-fidelity training data than a bare label.
 *
 * Human reasoning is REQUIRED on every submission (it's the whole point).
 */

const itemSchema = z.object({
  prompt: z.string().min(1),
  /** Optional reference material, dataset row context, retrieval results, etc. */
  context: z.string().optional(),
})

const responseSchema = z.object({
  /** Filled by AI before the human sees the item */
  claudeProposal: z.string(),
  claudeConfidence: z.number().min(0).max(1),
  claudeReasoning: z.string(),
  /** Human-driven fields */
  humanAction: z.enum(['accept', 'edit', 'reject']),
  humanFinal: z.string().min(1),
  humanReasoning: z
    .string()
    .min(1, 'Reasoning is required — capture the teaching signal.'),
})

export const pairAnnotationTemplate: PlatformTemplate = {
  mode: 'pair-annotation',
  name: 'Pair Annotation',
  description:
    'You and Claude annotate together. Every edit captures teaching signal — higher-fidelity training data than labels alone.',
  itemSchema,
  responseSchema,
  workflow: ['drafting', 'submitted', 'approved', 'rejected'],
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
    qualityMultiplierMax: 2.0, // pair work yields higher-value data
  },
  ui: {
    theme: 'minimal',
    layout: 'split-screen',
  },
}

registerTemplate(pairAnnotationTemplate)
