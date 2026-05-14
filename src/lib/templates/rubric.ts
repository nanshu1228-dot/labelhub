import { z } from 'zod'

/**
 * Rubric specification — Pillar 4's data-driven UI layer.
 *
 * A rubric is the set of *questions* an annotator is asked to answer about
 * each step (per-step rubric) and about the trajectory as a whole
 * (per-trajectory rubric). Every PlatformTemplate that wants to evaluate
 * agent traces declares its own rubric here.
 *
 * The rubric is consumed in two places:
 *
 *   1. Annotation UI       — renders one input per RubricItem, conditionally
 *                            shown based on `appliesTo` and the step's kind.
 *   2. Analytics / IAA     — keyed by `id`, so we can compute "agreement on
 *                            tool_choice" across raters without hardcoding
 *                            question names anywhere in the platform.
 *
 * Why this lives next to PlatformTemplate (not buried inside the page):
 *   - Different template modes need different rubrics (arena-battle has
 *     winner/tie/loser per dim; agent-trace-eval has likert + bool + enum).
 *   - Lifting it to the template layer means an admin can swap rubrics
 *     without touching React code — true to Pillar 4 ("Schema-Driven Templates").
 */

/**
 * Canonical step-kind enum — mirrors `trajectory_steps.kind` in the DB schema.
 *
 * Kept in sync by hand (drizzle text columns are validated in code, not DB).
 * If you add a kind in `src/lib/db/schema.ts` you MUST add it here too —
 * otherwise rubric.appliesTo can't target it.
 */
export const TRAJECTORY_STEP_KINDS = [
  'thinking',
  'tool_call',
  'tool_result',
  'sub_agent_call',
  'sub_agent_response',
  'final_response',
  'error',
] as const

export type TrajectoryStepKind = (typeof TRAJECTORY_STEP_KINDS)[number]

/**
 * Step-kind matcher used by per-step rubric items.
 *
 *   ['*']                — applies to every step kind (e.g. "Safety")
 *   ['tool_call']        — only when the step is a tool invocation
 *   ['thinking', 'final_response'] — when the step is reasoning or output
 *
 * Empty array is rejected (use ['*'] to mean "always" instead).
 */
export type StepKindMatcher =
  | readonly ['*']
  | readonly TrajectoryStepKind[]

/**
 * The four scales supported by the annotation UI.
 *
 *   likert — 3-point (1=bad, 3=mid, 5=good). 1·3·5 chosen over 1·2·3·4·5
 *            because raters cluster on the middle; forcing a clear "bad / ok /
 *            good" decision improves inter-annotator agreement.
 *   bool   — single toggle. Used for safety/policy flags.
 *   enum   — single-select from `options`. Used for categorical judgments
 *            like path optimality.
 *   text   — free-form notes. Autosaves on blur (NEVER on keystroke — that's
 *            a hard perf rule, see AGENTS.md).
 */
export type RubricScale = 'likert' | 'bool' | 'enum' | 'text'

/**
 * Severity ladder borrowed from Xpert's "雷区 / 一级误区 / 重要 / 必要 / 附加"
 * but collapsed to a 3-tier scale we can render compactly:
 *
 *   - `critical` — a single bad rating on this rubric **vetoes the entire
 *                  annotation**. Used for safety / policy / compliance flags.
 *                  Renders with a red 🔥 badge.
 *   - `major`    — a low rating drags the trajectory's quality score down
 *                  significantly (5x weight in calibration). Renders with
 *                  a violet ★ badge.
 *   - `minor`    — default. Treated as informational signal.
 *
 * When omitted, the rubric defaults to `minor`. Aggregation behavior lives
 * in `src/lib/quality/calibrate.ts`; the UI's job is to make severity
 * visible so annotators don't blow past a critical flag by accident.
 */
export type RubricSeverity = 'critical' | 'major' | 'minor'

export interface RubricItem {
  /** Stable machine ID — used as the storage key in `step_annotations.payload`
   *  and as the IAA aggregation key. Never rename without a migration. */
  id: string
  /** Human label shown next to the input. */
  name: string
  /** Optional one-liner shown below the label or in a tooltip. */
  description?: string
  scale: RubricScale
  /** Required when `scale === 'enum'`. Choices in display order. */
  options?: readonly string[]
  /** Required when `scale === 'likert'` — only used by per-step items.
   *  Per-trajectory rubric items don't have an `appliesTo` (they always apply). */
  appliesTo?: StepKindMatcher
  /** When true, the UI marks the reason field amber if a rating is recorded
   *  but the reason is empty ("Deep Dive" mode in the design). */
  requiresReason?: boolean
  /**
   * Quality-impact tier. Defaults to 'minor' when omitted. See `RubricSeverity`.
   * Critical rubrics are visually flagged in the annotator and can veto
   * the trajectory's overall quality score on aggregation.
   */
  severity?: RubricSeverity
}

export interface RubricSpec {
  /** Per-step questions — one set of inputs PER step that matches `appliesTo`. */
  perStep: readonly RubricItem[]
  /** Per-trajectory questions — one set of inputs for the whole trajectory. */
  perTrajectory: readonly RubricItem[]
}

// ─── Zod runtime validation (for safety when loading rubrics from JSON/DB) ───

const stepKindEnum = z.enum(TRAJECTORY_STEP_KINDS)

const stepKindMatcherSchema = z.union([
  z.tuple([z.literal('*')]).readonly(),
  z.array(stepKindEnum).min(1).readonly(),
])

const rubricScaleSchema = z.enum(['likert', 'bool', 'enum', 'text'])
const rubricSeveritySchema = z.enum(['critical', 'major', 'minor'])

export const rubricItemSchema = z
  .object({
    id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, {
      message:
        'Rubric id must be lowercase snake_case (matches /^[a-z][a-z0-9_]*$/). Used as a storage key.',
    }),
    name: z.string().min(1).max(80),
    description: z.string().max(280).optional(),
    scale: rubricScaleSchema,
    options: z.array(z.string().min(1).max(40)).min(2).max(8).optional(),
    appliesTo: stepKindMatcherSchema.optional(),
    requiresReason: z.boolean().optional(),
    severity: rubricSeveritySchema.optional(),
  })
  .superRefine((item, ctx) => {
    if (item.scale === 'enum' && !item.options?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Rubric item "${item.id}" uses scale=enum but has no options.`,
      })
    }
    if (item.scale !== 'enum' && item.options?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Rubric item "${item.id}" has options but scale is "${item.scale}", not "enum".`,
      })
    }
  })

export const rubricSpecSchema = z.object({
  perStep: z.array(rubricItemSchema).readonly(),
  perTrajectory: z.array(rubricItemSchema).readonly(),
})

// ─── Helpers used by the annotation UI ─────────────────────────────────────

/**
 * Return only those per-step rubric items that apply to a step of the given kind.
 *
 * The design hardcoded `["*"]` matching; we keep that semantics but reject
 * `appliesTo: []` (use `['*']` explicitly to mean "all"). An item without
 * an `appliesTo` defaults to applying to all kinds — useful for templates
 * that don't want to think about step taxonomy.
 */
export function rubricsForStepKind(
  spec: RubricSpec,
  kind: TrajectoryStepKind,
): readonly RubricItem[] {
  return spec.perStep.filter((item) => {
    if (!item.appliesTo) return true
    if (item.appliesTo[0] === '*') return true
    return (item.appliesTo as readonly TrajectoryStepKind[]).includes(kind)
  })
}

/**
 * Mark value type — the discriminated union of every possible answer shape.
 * Used by `step_annotations.payload[rubricId]` and the trajectory-level
 * payload's `perTrajectory[rubricId]`. Each rubric item produces one Mark.
 */
export type Mark =
  | { scale: 'likert'; value: 1 | 3 | 5; reason?: string }
  | { scale: 'bool'; value: boolean; reason?: string }
  | { scale: 'enum'; value: string; reason?: string }
  | { scale: 'text'; value: string }

/** True if the mark records a real answer (vs. an empty placeholder). */
export function isMarkPopulated(mark: Mark | undefined | null): boolean {
  if (!mark) return false
  if (mark.scale === 'text') return mark.value.trim().length > 0
  return mark.value !== null && mark.value !== undefined
}

/**
 * "Deep Dive" check — has the rater scored this rubric without leaving a reason?
 * The annotation UI highlights the reason field amber in this state.
 */
export function isMarkMissingReason(
  item: RubricItem,
  mark: Mark | undefined | null,
): boolean {
  if (!mark || !isMarkPopulated(mark)) return false
  if (item.scale === 'text') return false
  if (mark.scale === 'text') return false
  if (!item.requiresReason) return false
  return !mark.reason || mark.reason.trim().length === 0
}
