/**
 * Form Designer / Renderer canonical schema (Finals P1).
 *
 * The serializable form definition the Designer outputs and the Renderer
 * consumes. Materials (text / textarea / select / file / json-editor /
 * rich-text / llm-trigger / show-item / group / tab-layout) all serialize
 * to a `FieldNode` of the corresponding `kind`.
 *
 * Per-kind config lives under `config: Record<string, unknown>` — kept
 * unstructured at the FormSchema layer so adding a 10th material doesn't
 * widen the top-level zod. Material registries (D3) carry the per-kind
 * config validation.
 *
 * Versioning: bump `version` whenever a backward-incompatible change
 * lands. The Renderer rejects unknown versions early.
 */

import { z } from 'zod'

export const FORM_SCHEMA_VERSION = 1

/** Materials shipped in D3. Kept lowercase-hyphen for URL / JSON parity. */
export const FIELD_KINDS = [
  'text',
  'textarea',
  'single-select',
  'multi-select',
  'rich-text',
  'file-upload',
  'json-editor',
  'llm-trigger',
  'show-item',
  // Container kinds — children sit in `children[]`.
  'group',
  'tab-layout',
] as const

export type FieldKind = (typeof FIELD_KINDS)[number]

/**
 * A linkage predicate. Mirrors the existing `ConditionalDisplay` shape
 * in src/lib/templates/types.ts:146-149 so reviewers see one consistent
 * concept across the codebase. D5 evaluates these against current form
 * values to drive visibility / required-when.
 */
export const linkagePredicateSchema = z.object({
  /** ID of the field whose value the predicate inspects. */
  fieldId: z.string().min(1),
  /** Comparison operator. */
  op: z.enum([
    'eq',
    'neq',
    'in',
    'notIn',
    'truthy',
    'falsy',
    'gte',
    'lte',
  ]),
  /** Comparison RHS. Optional for unary ops (truthy/falsy). */
  value: z.unknown().optional(),
})

export type LinkagePredicate = z.infer<typeof linkagePredicateSchema>

/**
 * Validation rule DSL. The D5 compiler maps these to Zod refinements at
 * Renderer load time. Keep small — only the rules the spec calls out.
 */
export const validationRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('required') }),
  z.object({ kind: z.literal('min-length'), value: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('max-length'), value: z.number().int().positive() }),
  z.object({ kind: z.literal('regex'), pattern: z.string().min(1) }),
  z.object({ kind: z.literal('min'), value: z.number() }),
  z.object({ kind: z.literal('max'), value: z.number() }),
])

export type ValidationRule = z.infer<typeof validationRuleSchema>

/**
 * A single field in the form. Recursive — container kinds (group, tab-
 * layout) carry `children`. Tab-layout's children are per-tab arrays
 * stored as nested groups; one group per visible tab so each tab is a
 * sortable list.
 */
export const fieldNodeSchema: z.ZodType<FieldNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    kind: z.enum(FIELD_KINDS),
    label: z.string().max(200),
    helperText: z.string().max(500).optional(),
    /** Per-kind config; D3 materials validate their slice. */
    config: z.record(z.string(), z.unknown()).default({}),
    visibleWhen: linkagePredicateSchema.optional(),
    requiredWhen: linkagePredicateSchema.optional(),
    validation: z.array(validationRuleSchema).default([]),
    children: z.array(fieldNodeSchema).optional(),
  }),
)

export interface FieldNode {
  id: string
  kind: FieldKind
  label: string
  helperText?: string
  config: Record<string, unknown>
  visibleWhen?: LinkagePredicate
  requiredWhen?: LinkagePredicate
  validation: ValidationRule[]
  children?: FieldNode[]
}

/**
 * The top-level form definition. `version` lets the Renderer reject
 * future migrations cleanly; `fields` is the canvas's ordered list.
 */
export const formSchemaSchema = z.object({
  version: z.literal(FORM_SCHEMA_VERSION),
  fields: z.array(fieldNodeSchema).default([]),
})

export type FormSchema = z.infer<typeof formSchemaSchema>

/** Empty starter — the canvas begins with nothing on it. */
export const EMPTY_FORM: FormSchema = {
  version: FORM_SCHEMA_VERSION,
  fields: [],
}
