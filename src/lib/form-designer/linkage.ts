/**
 * Linkage predicate evaluator — Finals P1 D5.
 *
 * Spec 4.2 calls out "字段联动" (field linkage). The Designer stores
 * a `visibleWhen` / `requiredWhen` predicate on a {@link FieldNode};
 * the Renderer (D6) calls {@link evaluatePredicate} against the
 * current form values to decide whether to render / require a field.
 *
 * The predicate shape mirrors the existing `ConditionalDisplay` in
 * src/lib/templates/types.ts:146-149 so reviewers see one consistent
 * concept across the codebase.
 *
 * Pure functions only — no React, no DOM, no async. Tested at unit
 * level via {@link evaluatePredicate} directly.
 */

import type { FieldNode, LinkagePredicate } from './schema'
import type { UploadedFormFile } from '@/components/form-materials/file-upload-field'

/** A flat dict of current form values keyed by field ID. */
export type FormValues = Record<string, unknown>

/**
 * The closed set of value shapes a single (non-container) field can hold
 * in a form payload. Derived from the runtime renderers + the validation
 * base-shapes in `validation.ts:pickBaseShape`:
 *
 *   - text / textarea / rich-text      → string
 *   - single-select                    → string (one option value)
 *   - multi-select / tag-select        → string[] (option values / tags)
 *   - file-upload                      → UploadedFormFile[] (or string ids,
 *                                        which `normalizeUploadValue` coerces)
 *   - json-editor                      → arbitrary JSON (object / array /
 *                                        string / number / boolean / null)
 *
 * The `boolean` / `number` members come from the json-editor JSON space —
 * there is no dedicated boolean field kind. `null` covers the "cleared /
 * not yet answered" state every renderer may emit. Container kinds
 * (group / tab-layout) nest a `FormValues` dict and are intentionally NOT
 * part of this leaf union.
 *
 * NOTE: this type is purely descriptive — it documents the value space for
 * consumers. The renderer plumbing keeps its `unknown` values (see
 * `RuntimeRendererProps.value`) because the flat `FormValues` dict yields
 * `unknown` per key, which is not assignable to this union without casts.
 */
export type FormValue =
  | string
  | string[]
  | boolean
  | number
  | Record<string, unknown>
  | UploadedFormFile[]
  | null

/**
 * Per-field-kind value mapping. Pairs each {@link FieldKind} with the
 * concrete {@link FormValue} member that kind produces at runtime. Mirrors
 * `pickBaseShape` in `validation.ts` so the type story stays consistent with
 * the Zod story.
 *
 * Container kinds (group / tab-layout) map to a nested {@link FormValues}
 * dict; the non-payload widgets (show-item / llm-trigger) carry no value.
 */
export type FieldValueByKind = {
  text: string
  textarea: string
  'rich-text': string
  'single-select': string
  'multi-select': string[]
  'tag-select': string[]
  'file-upload': UploadedFormFile[]
  'json-editor': Record<string, unknown> | unknown[] | string | number | boolean | null
  'llm-trigger': never
  'show-item': never
  group: FormValues
  'tab-layout': FormValues
}

/**
 * Evaluate a single predicate against the current form values.
 * Returns true if the predicate is satisfied, false otherwise.
 *
 * Operators (all reference {@link LinkagePredicate.op}):
 *   - eq       : strict deep-equal (Array.isArray-aware via JSON)
 *   - neq      : !eq
 *   - in       : RHS is an array; LHS must be one of its elements
 *   - notIn    : !in
 *   - truthy   : LHS is truthy (no RHS needed)
 *   - falsy    : !truthy
 *   - gte / lte: numeric comparison; non-numbers fail closed (false)
 */
export function evaluatePredicate(
  predicate: LinkagePredicate,
  values: FormValues,
): boolean {
  const lhs = values[predicate.fieldId]
  const rhs = predicate.value
  switch (predicate.op) {
    case 'eq':
      return deepEqual(lhs, rhs)
    case 'neq':
      return !deepEqual(lhs, rhs)
    case 'in':
      return Array.isArray(rhs) && rhs.some((v) => deepEqual(lhs, v))
    case 'notIn':
      return !(Array.isArray(rhs) && rhs.some((v) => deepEqual(lhs, v)))
    case 'truthy':
      return Boolean(lhs)
    case 'falsy':
      return !lhs
    case 'gte':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs >= rhs
    case 'lte':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs <= rhs
    default: {
      // Exhaustive — TS will error here if a new op is added without a case.
      const _exhaustive: never = predicate.op
      return _exhaustive
    }
  }
}

/**
 * Decide whether a field should be rendered in the current form
 * state. A field with no `visibleWhen` is always visible.
 */
export function isFieldVisible(field: FieldNode, values: FormValues): boolean {
  if (!field.visibleWhen) return true
  return evaluatePredicate(field.visibleWhen, values)
}

/**
 * Decide whether a field is required in the current form state.
 * Order of precedence:
 *   1. requiredWhen predicate → if it evaluates true, the field is required
 *      regardless of validation rules
 *   2. otherwise, fall back to the static `validation: [{kind:'required'}]`
 *
 * A hidden field is never required (matches every form-builder convention).
 */
export function isFieldRequired(
  field: FieldNode,
  values: FormValues,
): boolean {
  if (!isFieldVisible(field, values)) return false
  if (field.requiredWhen) {
    return evaluatePredicate(field.requiredWhen, values)
  }
  return field.validation.some((r) => r.kind === 'required')
}

/**
 * Walk a list of fields and filter to those currently visible. Used
 * by the Renderer to skip drawing hidden fields entirely (a cheaper
 * path than rendering invisible elements).
 *
 * Recurses into container children — a hidden parent hides its
 * children transitively.
 */
export function filterVisibleFields(
  fields: FieldNode[],
  values: FormValues,
): FieldNode[] {
  return fields
    .filter((f) => isFieldVisible(f, values))
    .map((f) => {
      if (!f.children || f.children.length === 0) return f
      return {
        ...f,
        children: filterVisibleFields(f.children, values),
      }
    })
}

/**
 * Deep structural equality for predicate RHS comparisons. Restricted
 * to JSON-safe values (primitives + arrays + plain objects). Anything
 * else falls back to reference equality.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const ak = Object.keys(ao)
    const bk = Object.keys(bo)
    if (ak.length !== bk.length) return false
    for (const k of ak) {
      if (!deepEqual(ao[k], bo[k])) return false
    }
    return true
  }
  return false
}
