'use client'

/**
 * Form Renderer — Finals P1 D6.
 *
 * Spec 4.2 calls out "渲染器与设计器解耦" by name. This module is the
 * runtime side of that split:
 *
 *   - INPUT  : a serialized FormSchema (from custom_form_schemas.schema
 *              or the D4 toJsonSchema → JSON Schema document)
 *   - OUTPUT : a controlled form UI; values flow through `onChange`,
 *              autosave + submit are owned by the parent
 *
 * Hard constraint: this file (and anything under `form-renderer/`)
 * MUST NOT import anything from `form-designer/`. The ESLint rule
 * `no-restricted-imports` enforces it; the rule is also encoded in
 * the file structure (look at the imports below — schema, registry,
 * linkage, validation all live in `lib/form-designer/` not
 * `components/form-designer/`).
 *
 * Materials registry (which IS used) is itself decoupled — it ships
 * runtimeRenderer components alongside the designerPreview ones, so
 * the Renderer mounts the registry's runtime component directly
 * without ever touching the canvas / palette / property-panel code.
 */

import { memo, useCallback, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type {
  FieldKind,
  FieldNode,
  FormSchema,
} from '@/lib/form-designer/schema'
import { formSchemaSchema } from '@/lib/form-designer/schema'
import {
  isFieldVisible,
  isFieldRequired,
  type FormValues,
} from '@/lib/form-designer/linkage'
import { getMaterial } from '@/components/form-materials/registry'
import type { FormUploadContext } from '@/components/form-materials/types'

export interface FormRendererProps {
  /** The saved FormSchema to render. Validated via Zod on mount. */
  schema: FormSchema
  /** Current form values (controlled). Keys = field IDs. */
  value: FormValues
  /** Bubble new values up. Parent debounces / autosaves. */
  onChange: (next: FormValues) => void
  /** Topic-derived context the show-item widget reads from. */
  itemData?: Record<string, unknown>
  /** Read-only flag — Reviewer view of a submitted annotation. */
  readOnly?: boolean
  /** Field-level validation errors keyed by dotted Designer path. */
  errors?: Record<string, string>
  /** Topic/workspace context used by runtime file-upload widgets. */
  uploadContext?: FormUploadContext
}

/**
 * Mount the Renderer at the top of the Labeler form.
 *
 *     <FormRenderer
 *       schema={schema}
 *       value={draft.payload}
 *       onChange={onPayloadChange}
 *       itemData={topic.itemData}
 *     />
 *
 * The component is intentionally controlled — the autosave hook
 * (`use-autosave-draft.ts`) handles persistence; the Renderer
 * itself is stateless beyond the schema-validation guard.
 */
export function FormRenderer({
  schema,
  value,
  onChange,
  itemData,
  readOnly = false,
  errors,
  uploadContext,
}: FormRendererProps) {
  // Validate the incoming schema. A future-version / malformed
  // document surfaces a banner instead of crashing the Labeler. Pure
  // derivation — no state-after-effect cycle.
  const schemaError = useMemo(() => {
    const parsed = formSchemaSchema.safeParse(schema)
    return parsed.success ? null : parsed.error.message
  }, [schema])

  const handleField = useCallback(
    (fieldId: string, next: unknown) => {
      onChange({ ...value, [fieldId]: next })
    },
    [onChange, value],
  )

  // D10 — sibling write for llm-trigger. The Renderer is the only
  // place that knows the full value-dict, so it exposes a callback
  // that material runtimes can use to fill targetFieldId. Other
  // materials ignore.
  const setSiblingField = useCallback(
    (fieldId: string, next: unknown) => {
      onChange({ ...value, [fieldId]: next })
    },
    [onChange, value],
  )

  if (schemaError) {
    return (
      <div
        className="rounded p-3 ts-12"
        style={{
          background: 'oklch(0.55 0.2 25 / 0.05)',
          border: '1px solid oklch(0.55 0.2 25 / 0.4)',
          color: 'var(--danger)',
        }}
      >
        Invalid form schema — Renderer refused to mount. See
        console for details.
      </div>
    )
  }

  const visibleFields = filterFieldsForCurrentScope(schema.fields, value)

  // D16 — discoverability banner. When any visible field is an
  // llm-trigger, even inside a group/tab container, show a one-line
  // hint at the top of the form so fresh Labelers know AI assist is
  // available.
  const hasAiAssist = fieldTreeHasKindInScope(
    schema.fields,
    value,
    'llm-trigger',
  )

  return (
    <div className="flex flex-col gap-4">
      {hasAiAssist && !readOnly ? (
        <div
          className="rounded p-2 ts-12 mono inline-flex items-center gap-2"
          style={{
            background: 'oklch(0.55 0.18 320 / 0.08)',
            border: '1px solid oklch(0.55 0.18 320 / 0.4)',
            color: 'oklch(0.55 0.18 320)',
            alignSelf: 'flex-start',
          }}
        >
          <Sparkles size={13} aria-hidden />
          <span>AI assist ready</span>
        </div>
      ) : null}
      {visibleFields.map((f) => (
        <RenderedField
          key={f.id}
          field={f}
          value={value[f.id]}
          allValues={value}
          itemData={itemData}
          readOnly={readOnly}
          errors={errors}
          pathPrefix={[]}
          uploadContext={uploadContext}
          onChange={(next) => handleField(f.id, next)}
          onSetField={setSiblingField}
        />
      ))}
    </div>
  )
}

function RenderedFieldImpl({
  field,
  value,
  allValues,
  itemData,
  readOnly,
  onChange,
  onSetField,
  errors,
  pathPrefix,
  uploadContext,
}: {
  field: FieldNode
  value: unknown
  allValues: FormValues
  itemData?: Record<string, unknown>
  readOnly: boolean
  onChange: (next: unknown) => void
  onSetField?: (fieldId: string, next: unknown) => void
  errors?: Record<string, string>
  pathPrefix: string[]
  uploadContext?: FormUploadContext
}) {
  const fieldPath = [...pathPrefix, field.id]
  // Container kinds the Renderer walks itself — they have no
  // payload of their own.
  if (field.kind === 'group') {
    return (
      <GroupBlock
        field={field}
        values={allValues}
        itemData={itemData}
        readOnly={readOnly}
        errors={errors}
        pathPrefix={fieldPath}
        uploadContext={uploadContext}
        onValuesChange={(v) => onChange(v)}
      />
    )
  }
  if (field.kind === 'tab-layout') {
    return (
      <TabLayoutBlock
        field={field}
        values={allValues}
        itemData={itemData}
        readOnly={readOnly}
        errors={errors}
        pathPrefix={fieldPath}
        uploadContext={uploadContext}
        onValuesChange={(v) => onChange(v)}
      />
    )
  }

  const mat = getMaterial(field.kind)
  const RuntimeWidget = mat?.runtimeRenderer
  const required = isFieldRequired(field, allValues)
  const error = errors?.[fieldPath.join('.')]

  // show-item resolves its display content from itemData via
  // sourcePath. We pull that here so the runtime widget can stay
  // pure (renders whatever `value` it gets).
  let resolvedValue = value
  if (field.kind === 'show-item' && itemData) {
    const cfg = field.config as { sourcePath?: string }
    resolvedValue = resolveDottedPath(itemData, cfg.sourcePath ?? '')
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="ts-13" style={{ color: 'var(--hi)' }}>
        {field.label}
        {required ? (
          <span className="ml-1" style={{ color: 'var(--danger)' }}>
            *
          </span>
        ) : null}
      </label>
      {field.helperText ? (
        <span className="ts-11" style={{ color: 'var(--mute2)' }}>
          {field.helperText}
        </span>
      ) : null}
      {RuntimeWidget ? (
        <RuntimeWidget
          field={field}
          value={resolvedValue}
          onChange={onChange}
          readOnly={readOnly}
          allValues={allValues}
          itemData={itemData}
          onSetField={onSetField}
          uploadContext={uploadContext}
        />
      ) : (
        <span className="ts-12" style={{ color: 'var(--mute2)' }}>
          (no runtime renderer for kind <code>{field.kind}</code>)
        </span>
      )}
      {error ? (
        <span className="ts-11" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      ) : null}
    </div>
  )
}

/**
 * D20-C — RenderedField wrapped in React.memo with a value-only
 * comparator so a keystroke in sibling field N doesn't re-render
 * fields 1..N-1 + N+1..50.
 *
 * Comparator ignores callback identity (parent re-creates these
 * inline; they're invoked, not introspected) but checks:
 *   - field reference (same FieldNode → same schema slice)
 *   - value identity (changes when this field's slot changed)
 *   - allValues reference (changes when any sibling moved; needed
 *     by llm-trigger's allValues prop, but for plain fields it's
 *     a forced-equal because the parent splats a fresh dict each
 *     time. We accept that compromise for fields that DON'T use
 *     allValues — see useFieldNeedsAllValues below.)
 *   - itemData reference, readOnly flag
 *
 * `llm-trigger` material is the only one that reads `allValues`; for
 * every other kind we can ignore that prop entirely. We detect this
 * by reading the field's kind in the comparator.
 */
const RenderedField = memo(RenderedFieldImpl, (prev, next) => {
  if (prev.field !== next.field) return false
  if (prev.value !== next.value) return false
  if (prev.readOnly !== next.readOnly) return false
  if (prev.itemData !== next.itemData) return false
  if (prev.errors !== next.errors) return false
  if (prev.uploadContext !== next.uploadContext) return false
  // llm-trigger consumes allValues; for it, we must invalidate when
  // the dict shifts. Every other kind can ignore allValues changes
  // (its own `value` slot already captures its state).
  const needsAllValues =
    next.field.kind === 'llm-trigger' ||
    (next.field.children?.some((c) => c.kind === 'llm-trigger') ?? false)
  if (needsAllValues && prev.allValues !== next.allValues) return false
  return true
})

/**
 * Group container — renders children inline. The group's value is
 * an object keyed by child id, mirroring the JSON Schema shape.
 */
function GroupBlock({
  field,
  values,
  itemData,
  readOnly,
  errors,
  pathPrefix,
  uploadContext,
  onValuesChange,
}: {
  field: FieldNode
  values: FormValues
  itemData?: Record<string, unknown>
  readOnly: boolean
  errors?: Record<string, string>
  pathPrefix: string[]
  uploadContext?: FormUploadContext
  onValuesChange: (next: FormValues) => void
}) {
  const groupValues = asFormValues(values[field.id])
  const children = field.children ?? []
  const cfg = field.config as { showTitle?: boolean; description?: string }
  const visibleChildren = filterFieldsForCurrentScope(children, groupValues)

  function setChild(childId: string, next: unknown) {
    onValuesChange({ ...groupValues, [childId]: next })
  }

  return (
    <fieldset
      className="rounded p-3 flex flex-col gap-3"
      style={{
        border: '1px solid var(--line)',
        background: 'var(--panel)',
      }}
    >
      {cfg.showTitle !== false ? (
        <legend className="ts-12 mono px-2" style={{ color: 'var(--mute)' }}>
          {field.label}
        </legend>
      ) : null}
      {cfg.description ? (
        <p className="ts-11" style={{ color: 'var(--mute2)' }}>
          {cfg.description}
        </p>
      ) : null}
      {visibleChildren.map((c) => (
        <RenderedField
          key={c.id}
          field={c}
          value={groupValues[c.id]}
          allValues={groupValues}
          itemData={itemData}
          readOnly={readOnly}
          errors={errors}
          pathPrefix={pathPrefix}
          uploadContext={uploadContext}
          onChange={(next) => setChild(c.id, next)}
          onSetField={setChild}
        />
      ))}
    </fieldset>
  )
}

/**
 * Tab-layout — children[] is a list of group fields, one per tab.
 * The Renderer scopes the active tab's values just like the group
 * block; switching tabs preserves all values.
 */
function TabLayoutBlock({
  field,
  values,
  itemData,
  readOnly,
  errors,
  pathPrefix,
  uploadContext,
  onValuesChange,
}: {
  field: FieldNode
  values: FormValues
  itemData?: Record<string, unknown>
  readOnly: boolean
  errors?: Record<string, string>
  pathPrefix: string[]
  uploadContext?: FormUploadContext
  onValuesChange: (next: FormValues) => void
}) {
  const tabValues = asFormValues(values[field.id])
  const tabs = field.children ?? []
  const visibleTabs = filterFieldsForCurrentScope(tabs, tabValues)
  const [activeId, setActiveId] = useState(visibleTabs[0]?.id ?? '')
  const active = visibleTabs.find((t) => t.id === activeId) ?? visibleTabs[0]

  function setTabValues(next: FormValues) {
    onValuesChange(next)
  }

  if (!active) {
    return (
      <div className="ts-12" style={{ color: 'var(--mute2)' }}>
        Empty tab layout — open the Designer to add tabs.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 flex-wrap">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveId(t.id)}
            className="ts-12 mono px-3 py-1.5 rounded"
            style={{
              background: active.id === t.id ? 'var(--accent-soft)' : 'var(--panel2)',
              border: `1px solid ${active.id === t.id ? 'var(--accent-line)' : 'var(--line)'}`,
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {t.label || t.id}
          </button>
        ))}
      </div>
      <GroupBlock
        field={active}
        values={tabValues}
        itemData={itemData}
        readOnly={readOnly}
        errors={errors}
        pathPrefix={pathPrefix}
        uploadContext={uploadContext}
        onValuesChange={(next) =>
          setTabValues({ ...tabValues, [active.id]: next[active.id] ?? next })
        }
      />
    </div>
  )
}

/**
 * Look up `a.b.c` inside a JSON-ish object. Returns undefined if any
 * segment is missing. Identical semantics to the show-item.sourcePath
 * accessor.
 */
function resolveDottedPath(
  source: Record<string, unknown> | unknown,
  path: string,
): unknown {
  if (!path) return source
  const parts = path.split('.')
  let cur: unknown = source
  for (const p of parts) {
    if (cur && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return cur
}

export { resolveDottedPath }

export function filterFieldsForCurrentScope(
  fields: FieldNode[],
  values: FormValues,
): FieldNode[] {
  return fields.filter((field) => isFieldVisible(field, values))
}

export function fieldTreeHasKindInScope(
  fields: FieldNode[],
  values: FormValues,
  kind: FieldKind,
): boolean {
  for (const field of fields) {
    if (!isFieldVisible(field, values)) continue
    if (field.kind === kind) return true

    if (field.kind === 'group') {
      if (
        fieldTreeHasKindInScope(
          field.children ?? [],
          asFormValues(values[field.id]),
          kind,
        )
      ) {
        return true
      }
      continue
    }

    if (field.kind === 'tab-layout') {
      const layoutValues = asFormValues(values[field.id])
      for (const tab of field.children ?? []) {
        if (!isFieldVisible(tab, layoutValues)) continue
        if (tab.kind === kind) return true
        if (
          fieldTreeHasKindInScope(
            tab.children ?? [],
            asFormValues(layoutValues[tab.id]),
            kind,
          )
        ) {
          return true
        }
      }
      continue
    }

    if (
      field.children &&
      fieldTreeHasKindInScope(field.children, values, kind)
    ) {
      return true
    }
  }
  return false
}

function asFormValues(value: unknown): FormValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as FormValues
}
