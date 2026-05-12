import { z } from 'zod'

/**
 * Template Engine — Pillar 4.
 *
 * A PlatformTemplate is a declarative spec for one annotation paradigm:
 * data shape, workflow, UI hints, economy, and a perf budget the registry enforces.
 *
 * Admins pick a template when creating a workspace. One backend, many UX modes.
 */

/**
 * Single source of truth for template modes — both the runtime array (for Zod enums,
 * registry iteration) and the compile-time union (for type narrowing).
 */
export const TEMPLATE_MODES = [
  'classic-survey', // Xpert-style: prompt + multi-model responses + rubric scoring
  'pair-annotation', // Innovation #1: AI proposes, human curates, delta captured
  'arena-battle', // LMSYS-style: two models compete, human judges
  'token-economy', // Optional crypto-flavor: stake reputation, earn tokens
  'game-mode', // Streaks, leagues, leaderboards
  'apprentice-mode', // Personalized AI partner that learns the user
  'agent-trace-eval', // FLAGSHIP: evaluate agent trajectories — tool calls, reasoning, path choice
] as const

export type TemplateMode = (typeof TEMPLATE_MODES)[number]

export const perfBudgetSchema = z.object({
  /** Maximum rows in any editable grid (rubrics × models, items, etc.) */
  maxItemsPerCell: z.number().int().positive(),
  /** True when lists past `maxItemsPerCell/2` MUST use @tanstack/react-virtual */
  virtualizationRequired: z.boolean(),
  /** True when row state MUST live in Jotai atomFamily, not parent useState */
  atomicStateRequired: z.boolean(),
  /** Autosave cadence — 'on-blur' | 'on-submit' | 'debounce-XXXms' */
  autoSavePolicy: z.union([
    z.literal('on-blur'),
    z.literal('on-submit'),
    z.string().regex(/^debounce-\d+ms$/),
  ]),
  /** Cap free-text fields to prevent 100KB payloads (optional) */
  maxResponseLengthChars: z.number().int().positive().optional(),
})
export type PerfBudget = z.infer<typeof perfBudgetSchema>

export const workflowStageSchema = z.enum([
  'drafting',
  'revising',
  'submitted',
  'reviewing',
  'approved',
  'rejected',
])
export type WorkflowStage = z.infer<typeof workflowStageSchema>

export const economyConfigSchema = z.object({
  type: z.enum([
    'cash-per-item',
    'cash-per-hour',
    'volunteer',
    'token',
    'rating-elo',
  ]),
  currency: z.string().optional(),
  qualityMultiplierMin: z.number().positive().optional(),
  qualityMultiplierMax: z.number().positive().optional(),
})
export type EconomyConfig = z.infer<typeof economyConfigSchema>

export const uiHintsSchema = z.object({
  theme: z.enum(['classic', 'cyberpunk', 'minimal', 'game', 'web3']),
  layout: z.enum([
    'single-column',
    'split-screen',
    'sidebar-detail',
    'wallet-first',
  ]),
})
export type UIHints = z.infer<typeof uiHintsSchema>

/**
 * A complete platform template.
 * Item/response schemas are `ZodTypeAny` so each mode defines its own data shape.
 */
export interface PlatformTemplate {
  mode: TemplateMode
  name: string
  description: string

  /** Shape of one labeling item (one row in the dataset) */
  itemSchema: z.ZodTypeAny
  /** Shape of one annotator response (what they submit) */
  responseSchema: z.ZodTypeAny

  workflow: readonly WorkflowStage[]
  perfBudget: PerfBudget
  economy: EconomyConfig
  ui: UIHints
}

/**
 * Static lint that rejects templates which would scale-fail at runtime.
 * The registry calls this automatically; admins never see broken templates ship.
 */
export function validateTemplate(
  t: PlatformTemplate,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []

  if (
    t.perfBudget.maxItemsPerCell > 30 &&
    !t.perfBudget.virtualizationRequired
  ) {
    errors.push(
      `[${t.name}] maxItemsPerCell=${t.perfBudget.maxItemsPerCell} requires virtualizationRequired=true (>30 rows).`,
    )
  }
  if (
    t.perfBudget.maxItemsPerCell > 100 &&
    !t.perfBudget.atomicStateRequired
  ) {
    errors.push(
      `[${t.name}] maxItemsPerCell=${t.perfBudget.maxItemsPerCell} requires atomicStateRequired=true (>100 rows).`,
    )
  }

  return errors.length ? { ok: false, errors } : { ok: true }
}
