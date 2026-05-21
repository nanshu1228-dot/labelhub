/**
 * FormSchema ↔ JSON Schema (draft-07) round-trip — Finals P1 D4.
 *
 * Spec 4.2 calls out "可序列化为 JSON Schema" by name. The Designer's
 * internal {@link FormSchema} is the source of truth on disk (Pillar 4:
 * Schema-Driven Templates); this serializer projects it into a portable
 * draft-07 document so external consumers can validate submissions
 * without pulling LabelHub-specific code.
 *
 * Information unique to the Designer (widget kind, helper text, linkage
 * predicates, validation rules, layout) survives in `x-labelhub-*`
 * extension keywords. The round-trip is *byte-identical* for any
 * well-formed FormSchema — see `serialize.test.ts` for the property
 * tests per widget.
 *
 * D6 storage layer (custom_form_schemas.json_schema column) writes the
 * draft-07 doc returned here; the Renderer consumes the same column on
 * load and decodes it back via {@link fromJsonSchema}.
 *
 *     FormSchema → toJsonSchema → JSONSchemaForm → fromJsonSchema → FormSchema
 *
 * Design notes:
 *   - One $defs entry per field, keyed by field.id. Top-level fields[]
 *     becomes a `properties` map + `required` list at the root.
 *   - Container kinds (group, tab-layout) emit nested $defs the same
 *     way; children land in their own $defs entries with parent
 *     metadata.
 *   - validation.required is mirrored into the JSON Schema `required`
 *     array at the parent level (the canonical draft-07 location);
 *     other rules become `minLength` / `maxLength` / `pattern` /
 *     `minimum` / `maximum` on the field's own subschema.
 *   - Unknown / future kinds round-trip through `x-labelhub-kind` so
 *     forward compat doesn't break.
 */

import {
  FORM_SCHEMA_VERSION,
  FIELD_KINDS,
  formSchemaSchema,
  type FieldKind,
  type FieldNode,
  type FormSchema,
  type LinkagePredicate,
  type ValidationRule,
} from './schema'

/** Loose draft-07 JSON Schema shape. We only assert keys we touch. */
export interface JSONSchemaForm {
  $schema: 'http://json-schema.org/draft-07/schema#'
  $id?: string
  type: 'object'
  title?: string
  /** Schema version we emitted from (mirrors FormSchema.version). */
  'x-labelhub-version': number
  properties: Record<string, JSONSchemaField>
  required: string[]
  /** Ordered list of field IDs at the root (= canvas order). */
  'x-labelhub-order': string[]
}

/** Per-field draft-07 subschema. */
export interface JSONSchemaField {
  type?: string
  title?: string
  description?: string
  enum?: string[]
  items?: JSONSchemaField | { type: string; enum?: string[] }
  uniqueItems?: boolean
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  pattern?: string
  properties?: Record<string, JSONSchemaField>
  required?: string[]
  /** Designer-only extensions. */
  'x-labelhub-kind': FieldKind
  'x-labelhub-id': string
  'x-labelhub-config'?: Record<string, unknown>
  'x-labelhub-visible-when'?: LinkagePredicate
  'x-labelhub-required-when'?: LinkagePredicate
  'x-labelhub-validation'?: ValidationRule[]
  'x-labelhub-helper'?: string
  /** Order of children for container kinds. */
  'x-labelhub-children-order'?: string[]
}

const SCHEMA_URI = 'http://json-schema.org/draft-07/schema#' as const
const KIND_SET = new Set<string>(FIELD_KINDS)

/**
 * Map a FieldKind onto the closest draft-07 `type`. Container kinds use
 * `object`; lists use `array`; the rest are `string`.
 */
function baseTypeFor(kind: FieldKind): string {
  switch (kind) {
    case 'multi-select':
    case 'file-upload':
      return 'array'
    case 'group':
    case 'tab-layout':
      return 'object'
    case 'json-editor':
      // JSON editor accepts any JSON value; intentionally leave `type`
      // off so the field is permissive at the outer layer (config-level
      // `jsonSchema` validates the inner doc).
      return ''
    case 'llm-trigger':
    case 'show-item':
      // Non-submission widgets — no payload type.
      return ''
    default:
      return 'string'
  }
}

/**
 * Lift rules from {@link FieldNode.validation} into draft-07 keywords on
 * the per-field subschema. `required` is intentionally NOT lifted here —
 * it's surfaced at the parent's `required` array (draft-07 idiomatic).
 */
function applyValidation(target: JSONSchemaField, rules: ValidationRule[]): void {
  for (const r of rules) {
    if (r.kind === 'required') continue
    if (target.type === 'array') {
      // String-length-style rules map to array-length-style on arrays.
      if (r.kind === 'min-length') target.minItems = r.value
      else if (r.kind === 'max-length') target.maxItems = r.value
      else if (r.kind === 'min') target.minimum = r.value
      else if (r.kind === 'max') target.maximum = r.value
      else if (r.kind === 'regex') target.pattern = r.pattern
      continue
    }
    if (r.kind === 'min-length') target.minLength = r.value
    else if (r.kind === 'max-length') target.maxLength = r.value
    else if (r.kind === 'min') target.minimum = r.value
    else if (r.kind === 'max') target.maximum = r.value
    else if (r.kind === 'regex') target.pattern = r.pattern
  }
}

/**
 * For a `single-select` / `multi-select` field, lift `options[].value`
 * into `enum` (or `items.enum` on the array form). The full
 * `options[]` with labels survives in `x-labelhub-config` so the
 * Designer can rehydrate the UI exactly.
 */
function applyEnumIfSelect(target: JSONSchemaField, field: FieldNode): void {
  const opts = (field.config as { options?: Array<{ value: string }> })
    .options
  if (!opts || !Array.isArray(opts) || opts.length === 0) return
  const values = opts.map((o) => o.value)
  if (field.kind === 'single-select') {
    target.enum = values
  } else if (field.kind === 'multi-select') {
    target.items = { type: 'string', enum: values }
    target.uniqueItems = true
  }
}

/**
 * Apply config-derived draft-07 limits the spec-aware way:
 *   - text / textarea / rich-text: cfg.maxLength → maxLength
 *   - file-upload: cfg.maxFiles → maxItems; items.type = 'string'
 *   - multi-select: cfg.minSelected / cfg.maxSelected → minItems / maxItems
 */
function applyConfigLimits(target: JSONSchemaField, field: FieldNode): void {
  const cfg = field.config as Record<string, unknown>
  if (field.kind === 'text' || field.kind === 'textarea' || field.kind === 'rich-text') {
    if (typeof cfg.maxLength === 'number' && target.maxLength === undefined) {
      target.maxLength = cfg.maxLength
    }
    if (
      field.kind === 'rich-text' &&
      typeof cfg.minLength === 'number' &&
      target.minLength === undefined
    ) {
      target.minLength = cfg.minLength
    }
  }
  if (field.kind === 'file-upload') {
    if (typeof cfg.maxFiles === 'number' && target.maxItems === undefined) {
      target.maxItems = cfg.maxFiles
    }
    target.items = { type: 'string' }
  }
  if (field.kind === 'multi-select') {
    if (typeof cfg.minSelected === 'number' && target.minItems === undefined) {
      target.minItems = cfg.minSelected
    }
    if (typeof cfg.maxSelected === 'number' && target.maxItems === undefined) {
      target.maxItems = cfg.maxSelected
    }
  }
}

/** Emit one per-field draft-07 subschema. */
function fieldToJsonSchema(field: FieldNode): JSONSchemaField {
  const t = baseTypeFor(field.kind)
  const out: JSONSchemaField = {
    'x-labelhub-kind': field.kind,
    'x-labelhub-id': field.id,
  }
  if (t) out.type = t
  if (field.label) out.title = field.label
  if (field.helperText) {
    out.description = field.helperText
    out['x-labelhub-helper'] = field.helperText
  }
  if (field.config && Object.keys(field.config).length > 0) {
    out['x-labelhub-config'] = field.config
  }
  if (field.visibleWhen) out['x-labelhub-visible-when'] = field.visibleWhen
  if (field.requiredWhen) out['x-labelhub-required-when'] = field.requiredWhen
  if (field.validation.length > 0) {
    out['x-labelhub-validation'] = field.validation
  }
  applyEnumIfSelect(out, field)
  applyConfigLimits(out, field)
  applyValidation(out, field.validation)

  // Container kinds: nest children as properties of an object subschema.
  if ((field.kind === 'group' || field.kind === 'tab-layout') && field.children) {
    const children = field.children
    out.type = 'object'
    out.properties = {}
    const required: string[] = []
    for (const c of children) {
      out.properties[c.id] = fieldToJsonSchema(c)
      if (c.validation.some((r) => r.kind === 'required')) {
        required.push(c.id)
      }
    }
    if (required.length > 0) out.required = required
    out['x-labelhub-children-order'] = children.map((c) => c.id)
  }

  return out
}

/**
 * Project a FormSchema into a draft-07 JSON Schema document. The
 * returned object is JSON-safe (no functions, no class instances).
 */
export function toJsonSchema(schema: FormSchema, opts?: { title?: string; id?: string }): JSONSchemaForm {
  // Validate input — surface bad shapes loudly so the Designer doesn't
  // round-trip garbage. Throws if schema fails the Zod definition.
  formSchemaSchema.parse(schema)

  const properties: Record<string, JSONSchemaField> = {}
  const required: string[] = []
  for (const f of schema.fields) {
    properties[f.id] = fieldToJsonSchema(f)
    if (f.validation.some((r) => r.kind === 'required')) {
      required.push(f.id)
    }
  }

  const out: JSONSchemaForm = {
    $schema: SCHEMA_URI,
    type: 'object',
    'x-labelhub-version': schema.version,
    properties,
    required,
    'x-labelhub-order': schema.fields.map((f) => f.id),
  }
  if (opts?.title) out.title = opts.title
  if (opts?.id) out.$id = opts.id
  return out
}

/** Read a per-field subschema back into a FieldNode. */
function fieldFromJsonSchema(
  id: string,
  sub: JSONSchemaField,
  parentRequiredIds: ReadonlySet<string>,
): FieldNode {
  const kind = sub['x-labelhub-kind']
  if (!kind || !KIND_SET.has(kind)) {
    throw new Error(
      `JSON Schema property "${id}" is missing the x-labelhub-kind extension; cannot map to a FieldNode`,
    )
  }
  const config = sub['x-labelhub-config'] ?? {}
  const validation: ValidationRule[] = [...(sub['x-labelhub-validation'] ?? [])]
  // If the parent requires this id and the validation list doesn't
  // already include 'required', synthesize one so the FormSchema-side
  // representation is canonical.
  if (parentRequiredIds.has(id) && !validation.some((r) => r.kind === 'required')) {
    validation.unshift({ kind: 'required' })
  }
  const node: FieldNode = {
    id,
    kind,
    label: sub.title ?? '',
    config,
    validation,
  }
  const helper = sub['x-labelhub-helper'] ?? sub.description
  if (helper) node.helperText = helper
  if (sub['x-labelhub-visible-when']) node.visibleWhen = sub['x-labelhub-visible-when']
  if (sub['x-labelhub-required-when']) node.requiredWhen = sub['x-labelhub-required-when']

  if ((kind === 'group' || kind === 'tab-layout') && sub.properties) {
    const order = sub['x-labelhub-children-order'] ?? Object.keys(sub.properties)
    const subRequired = new Set(sub.required ?? [])
    node.children = order
      .filter((cid) => sub.properties && sub.properties[cid])
      .map((cid) => fieldFromJsonSchema(cid, sub.properties![cid], subRequired))
  }

  return node
}

/**
 * Inverse of {@link toJsonSchema}. Throws if the document is missing
 * the version / order extensions.
 */
export function fromJsonSchema(doc: JSONSchemaForm): FormSchema {
  if (doc.$schema !== SCHEMA_URI) {
    throw new Error(
      `Unsupported JSON Schema dialect; expected ${SCHEMA_URI} got ${doc.$schema}`,
    )
  }
  if (doc['x-labelhub-version'] !== FORM_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported FormSchema version: ${doc['x-labelhub-version']} (expected ${FORM_SCHEMA_VERSION})`,
    )
  }
  const order = doc['x-labelhub-order'] ?? Object.keys(doc.properties)
  const requiredAtRoot = new Set(doc.required ?? [])
  const fields: FieldNode[] = order
    .filter((id) => doc.properties[id])
    .map((id) => fieldFromJsonSchema(id, doc.properties[id], requiredAtRoot))

  return { version: FORM_SCHEMA_VERSION, fields }
}

/**
 * Convenience round-trip for tests and storage debugging. The output
 * should structurally equal the input for any well-formed FormSchema.
 */
export function roundTrip(schema: FormSchema): FormSchema {
  return fromJsonSchema(toJsonSchema(schema))
}
