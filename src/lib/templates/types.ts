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
/**
 * The three shipping template modes.
 *
 * Old modes (classic-survey / pair-annotation / arena-battle / token-economy /
 * game-mode / apprentice-mode) were removed in the 3-mode consolidation
 * on 2026-05-15 — the surface area was bigger than the user research justified.
 */
export const TEMPLATE_MODES = [
  /** Two-model Q&A with a SHARED boolean rubric — each rubric item gets a
   *  yes/no verdict against BOTH model A and model B. Ideal for factual
   *  questions where the rubric checks are objective. */
  'pair-rubric',
  /** Two-model arena with MULTI-DIMENSION 1-5 scoring — each dimension
   *  gets a 1-5 score for each model, GSB winner is auto-derived.
   *  Ideal for subjective / open-ended generation. */
  'arena-gsb',
  /** FLAGSHIP: evaluate full agent trajectories — tool calls, reasoning,
   *  path choice. Per-step + per-trajectory rubric. */
  'agent-trace-eval',
  /**
   * Finals D1 — PM-defined visual form schema. The Designer (P1) drops
   * widgets onto a canvas; the Renderer hydrates submitted task topic
   * data into the schema-driven form for the Labeler to fill. The
   * shape of itemData and responseSchema both come from the saved
   * `custom_form_schemas` row referenced by templateConfig.formSchemaId.
   *
   * Unlike the three baked-in modes, validation here is delegated to
   * the saved schema rather than a per-mode Zod object.
   */
  'custom-designer',
  /**
   * Rubric-authoring + judgement meta-review. A SINGLE model response is
   * pre-generated; the expert annotator AUTHORS a pass/fail rubric for it
   * and records a pass/fail verdict (per-criterion + overall). The AI
   * checker then audits the labeler's WORK in two passes: (1) the quality
   * of the rubric they wrote, and (2) whether their judgement is correct —
   * by independently applying their own rubric to the response and
   * comparing. Distinct from `pair-rubric`: one response judged pass/fail,
   * not a pairwise A/B comparison. Pairs with AI review taskKind
   * 'rubric_judgment'.
   */
  'rubric-judgment',
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
  /**
   * Finals P2 D9 — AI Review Agent verdict is in flight. Slots between
   * `submitted` and `reviewing`. The after-hook scheduler
   * (src/lib/actions/ai-review-submission.ts) advances topics here
   * when an `ai_submission_verdicts` row is `pending`, and forward to
   * one of:
   *   pass         → 'reviewing'
   *   send_back    → 'drafting' (with reason in annotation_revisions)
   *   human_review → 'reviewing' with priority flag in
   *                  templateConfig.aiAgent priorityFlag
   * The DB enum was extended in the D1 migration; this Zod side
   * catches up here so the state-machine work in D11/D12 can match
   * on it.
   */
  'ai_review',
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
  /** Legacy task rows created before the Owner form was aligned with billing. */
  amount: z.number().nonnegative().optional(),
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
 * Conditional-display predicate for a follow-up rubric item.
 *
 * The intent is to support nested check-then-detail flows: "is there code
 * in the response?" → if yes, "does the code compile?". Letting authors
 * declare this in the template config (vs hardcoding it in React) keeps
 * the engine in charge — the form code reads `showWhen` and decides what
 * to render.
 *
 * Two flavors, picked by the host template:
 *   - pair-rubric (boolean answers) → `when: true | false`. The child
 *     item renders when the parent's answer on the SAME side equals the
 *     declared boolean. We evaluate per-side: if A=true and B=false, then
 *     "child requires parent=true" shows for A only.
 *   - arena-gsb (1-5 scores) → `when: number` in [1, 5]. The child
 *     renders when the parent's score on that side is `>= when` (so
 *     `when: 4` means "only ask if the parent dimension scored ≥4").
 *     We picked min-threshold-only for v1; we can extend to operator+rhs
 *     later if real workflows need < or =.
 *
 * `parentId` MUST reference another item in the same list. Validation in
 * `effective.parseConfig` ensures the parent exists and isn't itself
 * conditional (one level of nesting, not arbitrary trees — that keeps
 * the cycle detection trivial).
 */
export interface ConditionalDisplay {
  parentId: string
  when: boolean | number
}

/**
 * Pair-comparison checklist item — used by `pair-rubric` (each item is
 * a yes/no check) and `arena-gsb` (each item is a 1-5 scoring dimension).
 *
 * Both modes ask the SAME question against BOTH model A and model B, so the
 * shape is identical — only the scale (boolean vs 1-5) differs, and that
 * lives in the template's `responseSchema`.
 *
 * The `id` is the storage key inside `annotations.payload.ratings[id]`
 * (or `.dimensions[id]`) — never rename after rows exist.
 */
export interface PairChecklistItem {
  /** Stable machine ID, snake_case. Used as storage key. */
  id: string
  /** Human label shown next to the input. */
  name: string
  /** Optional one-liner shown under the label. */
  description?: string
  /**
   * When set, this item renders only after the parent has been answered
   * in a matching way. See `ConditionalDisplay`. Items WITHOUT showWhen
   * are always visible — that's the only top-level case.
   */
  showWhen?: ConditionalDisplay
}

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
   * Used by `agent-trace-eval` (trajectory-shaped). Pair templates use
   * `pairChecklist` / `arenaDimensions` instead because the shape is
   * different: each item is asked against TWO responses (A and B), not
   * against a single step.
   *
   * When present, the annotation UI is driven entirely off this spec — no
   * hardcoded question lists anywhere in React.
   */
  rubric?: RubricSpec

  /**
   * Default boolean-checklist items for `pair-rubric` mode. Each item is
   * asked yes/no against BOTH model A and model B (so each row produces 2
   * booleans). When tasks.templateConfig overrides this list, those win.
   * Stored under `responseSchema.ratings[item.id] = { a: bool, b: bool }`.
   */
  pairChecklist?: readonly PairChecklistItem[]

  /**
   * Default 1-5 dimensions for `arena-gsb` mode. Same shape as pairChecklist
   * but scored 1-5 per model. Per-dimension GSB winner derives from the
   * delta; overall verdict is recorded separately on the response.
   * Stored under `responseSchema.dimensions[item.id] = { a: 1..5, b: 1..5 }`.
   */
  arenaDimensions?: readonly PairChecklistItem[]

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
