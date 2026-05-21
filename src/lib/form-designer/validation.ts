/**
 * Custom validation DSL → Zod compiler — Finals P1 D5.
 *
 * Spec 4.2 calls out "自定义校验" (custom validation). The Designer
 * stores rules per field on {@link FieldNode.validation} as a small
 * tagged union ({@link ValidationRule}); this module compiles that
 * list into a Zod refinement chain the Renderer (D6) can apply at
 * submit time.
 *
 * Why Zod (not JSON Schema's runtime AJV): we already ship Zod
 * everywhere (Drizzle, server actions, AI parsers) and its error
 * messages compose better with the form-renderer's per-field errors.
 *
 * One {@link compileFieldValidator} entry point. Returns:
 *   - a Zod schema sized to the field's kind (string / array / etc.)
 *   - augmented with min/max/regex/length/required refinements
 *
 * The compiled validators are pure — no React, no DOM, no async.
 * Tested in `validation.test.ts` with full kind × rule coverage.
 */

import { z } from 'zod'
import type { FieldNode, ValidationRule } from './schema'

/**
 * Compile the per-field validation rule list into a single Zod schema.
 * The Renderer reduces these into one object schema per form via
 * {@link compileFormValidator}.
 */
export function compileFieldValidator(field: FieldNode): z.ZodTypeAny {
  const requiredRule = field.validation.find((r) => r.kind === 'required')

  // Pick the base Zod shape from the field's kind.
  let base: z.ZodTypeAny = pickBaseShape(field)

  // Apply each rule. Order: length / range / regex.
  for (const r of field.validation) {
    base = applyRule(base, r, field)
  }

  // Required wrap. If NOT required, allow undefined / null / empty.
  if (!requiredRule) {
    base = base.optional().nullable()
  } else {
    // Reject empty string / empty array as failing 'required' for
    // string-y and array-y bases.
    base = base.refine(
      (v) => {
        if (v == null) return false
        if (typeof v === 'string') return v.length > 0
        if (Array.isArray(v)) return v.length > 0
        return true
      },
      { message: 'Required' },
    )
  }

  return base
}

/**
 * Compile a full FormSchema fields[] into a Zod object schema. The
 * keys are field IDs; values are the per-field validators.
 *
 * Visibility (visibleWhen) is NOT applied here — the Renderer hides
 * fields before submission, and the dynamic-required path
 * (requiredWhen) lives in `linkage.ts:isFieldRequired`. This
 * compiler captures the *static* per-field rules only.
 */
export function compileFormValidator(
  fields: FieldNode[],
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) {
    // Containers nest their own object validator.
    if ((f.kind === 'group' || f.kind === 'tab-layout') && f.children) {
      shape[f.id] = compileFormValidator(f.children)
      continue
    }
    // Non-payload widgets contribute nothing to the validator.
    if (f.kind === 'show-item' || f.kind === 'llm-trigger') continue
    shape[f.id] = compileFieldValidator(f)
  }
  return z.object(shape)
}

function pickBaseShape(field: FieldNode): z.ZodTypeAny {
  switch (field.kind) {
    case 'text':
    case 'textarea':
    case 'rich-text':
      return z.string()
    case 'single-select': {
      const opts = (field.config as { options?: Array<{ value: string }> }).options ?? []
      if (opts.length === 0) return z.string()
      // Use the option values as the union of allowed values.
      const literals = opts.map((o) => z.literal(o.value))
      if (literals.length === 1) return literals[0]
      return z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
    }
    case 'multi-select': {
      const opts = (field.config as { options?: Array<{ value: string }> }).options ?? []
      if (opts.length === 0) return z.array(z.string())
      const literals = opts.map((o) => z.literal(o.value))
      const item =
        literals.length === 1
          ? literals[0]
          : z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
      return z.array(item)
    }
    case 'file-upload':
      return z.array(z.string())
    case 'json-editor':
      // Permissive at the validator layer; the JSON Schema-aware
      // editor lives in the runtime renderer.
      return z.unknown()
    case 'show-item':
    case 'llm-trigger':
      return z.never()
    case 'group':
    case 'tab-layout':
      return z.record(z.string(), z.unknown())
    default: {
      const _exhaustive: never = field.kind
      return _exhaustive
    }
  }
}

function applyRule(
  base: z.ZodTypeAny,
  rule: ValidationRule,
  field: FieldNode,
): z.ZodTypeAny {
  if (rule.kind === 'required') return base

  // String-style rules apply on text-like fields.
  const isStringish =
    field.kind === 'text' ||
    field.kind === 'textarea' ||
    field.kind === 'rich-text'
  const isArrayish =
    field.kind === 'multi-select' || field.kind === 'file-upload'

  if (rule.kind === 'min-length') {
    if (isStringish) {
      return (base as z.ZodString).min(rule.value)
    }
    if (isArrayish) {
      return (base as z.ZodArray<z.ZodTypeAny>).min(rule.value)
    }
    return base
  }
  if (rule.kind === 'max-length') {
    if (isStringish) {
      return (base as z.ZodString).max(rule.value)
    }
    if (isArrayish) {
      return (base as z.ZodArray<z.ZodTypeAny>).max(rule.value)
    }
    return base
  }
  if (rule.kind === 'regex') {
    if (!isStringish) return base
    try {
      const re = new RegExp(rule.pattern)
      return (base as z.ZodString).regex(re)
    } catch {
      // Bad pattern — fail closed at validate time.
      return base.refine(() => false, {
        message: `Invalid regex pattern: ${rule.pattern}`,
      })
    }
  }
  if (rule.kind === 'min') {
    if (isStringish) {
      return base.refine(
        (v) =>
          typeof v === 'string'
            ? Number.isFinite(Number(v)) && Number(v) >= rule.value
            : true,
        { message: `Must be ≥ ${rule.value}` },
      )
    }
    return base
  }
  if (rule.kind === 'max') {
    if (isStringish) {
      return base.refine(
        (v) =>
          typeof v === 'string'
            ? Number.isFinite(Number(v)) && Number(v) <= rule.value
            : true,
        { message: `Must be ≤ ${rule.value}` },
      )
    }
    return base
  }
  return base
}
