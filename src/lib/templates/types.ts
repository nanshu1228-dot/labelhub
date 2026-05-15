import { z } from 'zod'
import type { RubricSpec } from './rubric'
import { rubricSpecSchema } from './rubric'

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
  'awaiting_acceptance',
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
  /**
   * ISO 4217 fiat code ('USD', 'CNY') OR a stablecoin symbol ('USDT', 'LBH').
   * Optional only for `volunteer` and `rating-elo` modes where no real money flows.
   */
  currency: z.string().min(3).max(8).optional(),
  /**
   * Base payout per completed item in MINOR units (cents / fen / 1e-6 USDT etc.).
   * Used by the billing engine (src/lib/billing/calculate-payout.ts) to compute
   * the actual payout: baseAmountMinor × qualityMultiplier + bonuses - penalties.
   *
   * Required for `cash-per-item` and `token`; optional otherwise.
   */
  baseAmountMinor: z.number().int().nonnegative().optional(),
  qualityMultiplierMin: z.number().positive().optional(),
  qualityMultiplierMax: z.number().positive().optional(),
  /**
   * Soft per-item time cap (seconds). When an annotation takes longer than
   * this, admin UI surfaces a "took NNm — over cap" indicator. Currently
   * informational only — we don't truncate payouts, since cash-per-item
   * mode already pays a fixed amount regardless of time spent. The signal
   * is for catching speed-skip (annotation < ~minCap seconds, low quality)
   * and time-fraud (annotation idle for hours).
   */
  maxBillableSeconds: z.number().int().positive().optional(),
  /**
   * Soft "looks too fast" floor (seconds). Annotations submitted under this
   * threshold are flagged for review — likely speed-skipping without reading.
   */
  minExpectedSeconds: z.number().int().positive().optional(),
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

  /**
   * Rubric — per-step and per-trajectory questions the annotator answers.
   *
   * Optional because not every template is trajectory-shaped. Trace-eval and
   * pair-annotation use it; classic-survey uses `itemSchema` instead because
   * its items aren't sequences.
   *
   * When present, the annotation UI is driven entirely off this spec — no
   * hardcoded question lists anywhere in React. Adding a new question is a
   * one-line edit to the template, no UI change needed.
   */
  rubric?: RubricSpec

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

  // Rubric structural validation — surface bad rubric items at template-registration
  // time instead of letting a malformed enum/missing-options sneak through to the UI.
  if (t.rubric) {
    const parsed = rubricSpecSchema.safeParse(t.rubric)
    if (!parsed.success) {
      errors.push(
        `[${t.name}] rubric failed validation: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join(' | ')}`,
      )
    } else {
      // Unique-id check — duplicate IDs would silently overwrite mark storage.
      const allIds = [...t.rubric.perStep, ...t.rubric.perTrajectory].map(
        (r) => r.id,
      )
      const seen = new Set<string>()
      const dupes = new Set<string>()
      for (const id of allIds) {
        if (seen.has(id)) dupes.add(id)
        seen.add(id)
      }
      if (dupes.size) {
        errors.push(
          `[${t.name}] rubric has duplicate item ids: ${[...dupes].join(', ')}. ` +
            `Per-step and per-trajectory IDs share a namespace because both land in step_annotations.payload.`,
        )
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true }
}
