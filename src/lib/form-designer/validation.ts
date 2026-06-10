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
import {
  isFieldRequired,
  isFieldVisible,
  type FormValues,
} from './linkage'
import type { UploadedFormFile } from '@/components/form-materials/file-upload-field'

/**
 * Object branch of an uploaded-file value. Annotated `z.ZodType<UploadedFormFile>`
 * so this schema stays structurally in sync with the {@link UploadedFormFile}
 * interface in `file-upload-field.tsx` — if that shape drifts, this annotation
 * fails to compile.
 *
 * `type` is required here (matching the interface) rather than `.optional()`;
 * every value producer (`normalizeUploadValue`, the `/api/form-uploads` route)
 * always emits a `type` string, so requiring it is behavior-preserving for all
 * real payloads and keeps the two definitions aligned. `.passthrough()` keeps
 * the historical "extra keys allowed" tolerance.
 */
const uploadedFileObjectSchema: z.ZodType<UploadedFormFile> = z
  .object({
    url: z.string().min(1),
    path: z.string().min(1),
    name: z.string().min(1),
    size: z.number().nonnegative(),
    type: z.string(),
    fieldId: z.string().optional(),
    uploadedAt: z.string().optional(),
  })
  .passthrough()

/**
 * A stored file-upload value entry: either a bare string id/url (which the
 * runtime `normalizeUploadValue` coerces into a full record) or a full
 * {@link UploadedFormFile} metadata object.
 */
const uploadedFileValueSchema = z.union([
  z.string().min(1),
  uploadedFileObjectSchema,
])

export interface FormValidationIssue {
  path: string[]
  fieldId: string
  label: string
  message: string
}

export interface FormValidationResult {
  success: boolean
  issues: FormValidationIssue[]
  fieldErrors: Record<string, string>
}

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
  base = applyConfigRefinements(base, field)

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

/**
 * Validate a concrete Designer payload against the current runtime state:
 *
 * - hidden fields are skipped
 * - requiredWhen is evaluated against the field's current sibling scope
 * - group/tab children validate inside their nested value object
 * - non-payload widgets (show-item / llm-trigger) are ignored
 *
 * This is the path used by the Labeler UI and the submit Server Action.
 * `compileFormValidator()` remains available for static schema projection,
 * but this helper is the one that enforces Designer linkage semantics.
 */
export function validateFormValues(
  fields: FieldNode[],
  values: FormValues,
): FormValidationResult {
  const issues: FormValidationIssue[] = []
  validateFieldScope({
    fields,
    values,
    pathPrefix: [],
    issues,
  })
  const fieldErrors: Record<string, string> = {}
  for (const issue of issues) {
    const key = issue.path.join('.')
    if (!fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return {
    success: issues.length === 0,
    issues,
    fieldErrors,
  }
}

function validateFieldScope({
  fields,
  values,
  pathPrefix,
  issues,
}: {
  fields: FieldNode[]
  values: FormValues
  pathPrefix: string[]
  issues: FormValidationIssue[]
}) {
  for (const field of fields) {
    if (!isFieldVisible(field, values)) continue
    const path = [...pathPrefix, field.id]

    if (field.kind === 'group') {
      validateFieldScope({
        fields: field.children ?? [],
        values: asFormValues(values[field.id]),
        pathPrefix: path,
        issues,
      })
      continue
    }

    if (field.kind === 'tab-layout') {
      const tabValues = asFormValues(values[field.id])
      for (const tab of field.children ?? []) {
        if (!isFieldVisible(tab, tabValues)) continue
        validateFieldScope({
          fields: tab.children ?? [],
          values: asFormValues(tabValues[tab.id]),
          pathPrefix: [...path, tab.id],
          issues,
        })
      }
      continue
    }

    if (field.kind === 'show-item' || field.kind === 'llm-trigger') {
      continue
    }

    const rawValue = values[field.id]
    if (isFieldRequired(field, values) && isEmptyRuntimeValue(rawValue)) {
      issues.push({
        path,
        fieldId: field.id,
        label: field.label || field.id,
        message: 'Required',
      })
      continue
    }

    const effectiveField = withRuntimeRequired(field, values)
    const result = compileFieldValidator(effectiveField).safeParse(
      rawValue,
    )
    if (!result.success) {
      for (const zodIssue of result.error.issues) {
        issues.push({
          path,
          fieldId: field.id,
          label: field.label || field.id,
          message: zodIssue.message,
        })
      }
    }
  }
}

function withRuntimeRequired(field: FieldNode, values: FormValues): FieldNode {
  const validation = field.validation.filter((r) => r.kind !== 'required')
  if (isFieldRequired(field, values)) {
    return {
      ...field,
      validation: [{ kind: 'required' }, ...validation],
    }
  }
  return {
    ...field,
    validation,
  }
}

function asFormValues(value: unknown): FormValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as FormValues
}

function isEmptyRuntimeValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
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
    case 'tag-select': {
      const cfg = field.config as {
        allowCustom?: boolean
        options?: Array<{ value: string }>
      }
      const opts = cfg.options ?? []
      if (cfg.allowCustom !== false || opts.length === 0) {
        return z.array(z.string())
      }
      const literals = opts.map((o) => z.literal(o.value))
      const item =
        literals.length === 1
          ? literals[0]
          : z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
      return z.array(item)
    }
    case 'file-upload':
      return fileUploadShape(field)
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

function fileUploadShape(field: FieldNode): z.ZodTypeAny {
  const cfg = field.config as {
    maxFiles?: number | null
  }
  let shape: z.ZodTypeAny = z.array(uploadedFileValueSchema)
  if (typeof cfg.maxFiles === 'number' && cfg.maxFiles > 0) {
    shape = (shape as z.ZodArray<typeof uploadedFileValueSchema>).max(
      cfg.maxFiles,
    )
  }
  return shape
}

function applyConfigRefinements(
  base: z.ZodTypeAny,
  field: FieldNode,
): z.ZodTypeAny {
  if (field.kind === 'tag-select') {
    return applyTagSelectConfigRefinements(base, field)
  }
  if (field.kind !== 'file-upload') return base
  const cfg = field.config as { maxSizeMb?: number | null }
  if (typeof cfg.maxSizeMb !== 'number' || cfg.maxSizeMb <= 0) return base
  const maxBytes = cfg.maxSizeMb * 1024 * 1024
  return base.refine(
    (files) =>
      Array.isArray(files) &&
      files.every((file) => {
        if (!file || typeof file !== 'object') return true
        const size = (file as { size?: unknown }).size
        return typeof size !== 'number' || size <= maxBytes
      }),
    { message: `File exceeds ${cfg.maxSizeMb}MB` },
  )
}

function applyTagSelectConfigRefinements(
  base: z.ZodTypeAny,
  field: FieldNode,
): z.ZodTypeAny {
  const cfg = field.config as {
    minTags?: number | null
    maxTags?: number | null
  }
  let shape = base
  if (typeof cfg.minTags === 'number' && cfg.minTags > 0) {
    shape = (shape as z.ZodArray<z.ZodTypeAny>).min(cfg.minTags)
  }
  if (typeof cfg.maxTags === 'number' && cfg.maxTags > 0) {
    shape = (shape as z.ZodArray<z.ZodTypeAny>).max(cfg.maxTags)
  }
  return shape
}

function applyRule(
  base: z.ZodTypeAny,
  rule: ValidationRule,
  field: FieldNode,
): z.ZodTypeAny {
  if (rule.kind === 'required') return base
  if (rule.kind === 'custom-function') {
    return applyCustomFunctionRule(base, rule)
  }

  // String-style rules apply on text-like fields.
  const isStringish =
    field.kind === 'text' ||
    field.kind === 'textarea' ||
    field.kind === 'rich-text'
  const isArrayish =
    field.kind === 'multi-select' ||
    field.kind === 'tag-select' ||
    field.kind === 'file-upload'

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

function applyCustomFunctionRule(
  base: z.ZodTypeAny,
  rule: Extract<ValidationRule, { kind: 'custom-function' }>,
): z.ZodTypeAny {
  const message = customFunctionMessage(rule)
  const argument = rule.argument?.trim()

  if (requiresArgument(rule.functionName) && !argument) {
    return base.refine(() => false, {
      message: `${rule.functionName} requires an argument`,
    })
  }

  return base.refine((value) => runCustomFunction(rule.functionName, value, argument), {
    message,
  })
}

function runCustomFunction(
  functionName: Extract<ValidationRule, { kind: 'custom-function' }>['functionName'],
  value: unknown,
  argument: string | undefined,
): boolean {
  switch (functionName) {
    case 'contains':
      return valueIncludes(value, argument ?? '')
    case 'not-contains':
      return !valueIncludes(value, argument ?? '')
    case 'starts-with':
      return typeof value === 'string' && value.startsWith(argument ?? '')
    case 'ends-with':
      return typeof value === 'string' && value.endsWith(argument ?? '')
    case 'json-object':
      return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    case 'json-array':
      return Array.isArray(value)
    default: {
      const _exhaustive: never = functionName
      return _exhaustive
    }
  }
}

function valueIncludes(value: unknown, needle: string): boolean {
  if (typeof value === 'string') return value.includes(needle)
  if (Array.isArray(value)) return value.includes(needle)
  return false
}

function requiresArgument(
  functionName: Extract<ValidationRule, { kind: 'custom-function' }>['functionName'],
): boolean {
  return (
    functionName === 'contains' ||
    functionName === 'not-contains' ||
    functionName === 'starts-with' ||
    functionName === 'ends-with'
  )
}

function customFunctionMessage(
  rule: Extract<ValidationRule, { kind: 'custom-function' }>,
): string {
  const custom = rule.message?.trim()
  if (custom) return custom
  const argument = rule.argument?.trim()
  switch (rule.functionName) {
    case 'contains':
      return `Must contain "${argument}"`
    case 'not-contains':
      return `Must not contain "${argument}"`
    case 'starts-with':
      return `Must start with "${argument}"`
    case 'ends-with':
      return `Must end with "${argument}"`
    case 'json-object':
      return 'Must be a JSON object'
    case 'json-array':
      return 'Must be a JSON array'
    default: {
      const _exhaustive: never = rule.functionName
      return _exhaustive
    }
  }
}
