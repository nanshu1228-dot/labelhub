'use client'

/**
 * Linkage editor — Finals P1 D5.
 *
 * Lets the owner attach a {@link LinkagePredicate} to a field's
 * `visibleWhen` and / or `requiredWhen`. The Renderer (D6) uses
 * `linkage.ts:isFieldVisible` / `isFieldRequired` to drive the
 * dynamic UI at submit time.
 *
 *   ┌────────────────────────────────────────┐
 *   │ § VISIBLE WHEN                         │
 *   │  field [ category ▼ ]  op [ eq  ▼ ]    │
 *   │  value [ other        ]   [Remove]     │
 *   └────────────────────────────────────────┘
 *
 * Targets only sibling fields at the same canvas level (the schema is
 * flat for D5; nested-field linkage lands in D6 along with the full
 * Renderer).
 */

import type { FieldNode, LinkagePredicate } from '@/lib/form-designer/schema'

const OPS: ReadonlyArray<{ value: LinkagePredicate['op']; label: string; needsValue: boolean }> = [
  { value: 'eq', label: 'equals', needsValue: true },
  { value: 'neq', label: 'not equals', needsValue: true },
  { value: 'in', label: 'is one of (comma-list)', needsValue: true },
  { value: 'notIn', label: 'is none of (comma-list)', needsValue: true },
  { value: 'truthy', label: 'is truthy', needsValue: false },
  { value: 'falsy', label: 'is falsy', needsValue: false },
  { value: 'gte', label: '≥', needsValue: true },
  { value: 'lte', label: '≤', needsValue: true },
]

export function LinkageEditor({
  field,
  siblings,
  onChange,
}: {
  field: FieldNode
  siblings: FieldNode[]
  onChange: (next: FieldNode) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <PredicateRow
        label="Visible when"
        emptyHint="Always visible."
        value={field.visibleWhen}
        siblings={siblings.filter((s) => s.id !== field.id)}
        onChange={(next) =>
          onChange({ ...field, visibleWhen: next })
        }
      />
      <PredicateRow
        label="Required when"
        emptyHint="Falls back to static 'Required' rule."
        value={field.requiredWhen}
        siblings={siblings.filter((s) => s.id !== field.id)}
        onChange={(next) =>
          onChange({ ...field, requiredWhen: next })
        }
      />
    </div>
  )
}

function PredicateRow({
  label,
  emptyHint,
  value,
  siblings,
  onChange,
}: {
  label: string
  emptyHint: string
  value: LinkagePredicate | undefined
  siblings: FieldNode[]
  onChange: (next: LinkagePredicate | undefined) => void
}) {
  const op = value
    ? OPS.find((o) => o.value === value.op) ?? OPS[0]
    : OPS[0]
  const literal = formatRhs(value)

  function update(patch: Partial<LinkagePredicate>) {
    const seed: LinkagePredicate =
      value ?? {
        fieldId: siblings[0]?.id ?? '',
        op: 'eq',
        value: '',
      }
    onChange({ ...seed, ...patch })
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="lh-mono lh-caption flex items-center justify-between"
        style={{ color: 'var(--mute)' }}
      >
        <span>{label.toUpperCase()}</span>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="ts-11 mono px-2 py-0.5 rounded"
            style={{
              background: 'transparent',
              color: 'var(--danger)',
              border: '1px solid oklch(0.55 0.2 25 / 0.4)',
              cursor: 'pointer',
            }}
            aria-label={`Remove ${label}`}
          >
            Remove
          </button>
        ) : null}
      </div>

      {!value ? (
        <button
          type="button"
          onClick={() =>
            onChange({
              fieldId: siblings[0]?.id ?? '',
              op: 'eq',
              value: '',
            })
          }
          disabled={siblings.length === 0}
          className="ts-12 mono px-2 py-1 rounded self-start"
          style={{
            background: 'var(--panel2)',
            color: siblings.length === 0 ? 'var(--mute2)' : 'var(--text)',
            border: '1px solid var(--line)',
            cursor: siblings.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          + Add linkage
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <select
              value={value.fieldId}
              onChange={(e) => update({ fieldId: e.target.value })}
              className="ts-12 mono"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '4px 8px',
                color: 'var(--text)',
                minWidth: 100,
              }}
            >
              {siblings.length === 0 ? (
                <option value="">no fields</option>
              ) : (
                siblings.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label || s.id}
                  </option>
                ))
              )}
            </select>
            <select
              value={value.op}
              onChange={(e) =>
                update({ op: e.target.value as LinkagePredicate['op'] })
              }
              className="ts-12 mono"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '4px 8px',
                color: 'var(--text)',
              }}
            >
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {op.needsValue ? (
            <input
              type="text"
              defaultValue={literal}
              onBlur={(e) => update({ value: parseRhs(e.target.value, op.value) })}
              placeholder={
                op.value === 'in' || op.value === 'notIn'
                  ? 'a, b, c'
                  : op.value === 'gte' || op.value === 'lte'
                    ? 'number'
                    : 'value'
              }
              className="ts-12 mono"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '4px 8px',
                color: 'var(--text)',
              }}
            />
          ) : null}
        </div>
      )}
      <span className="ts-11" style={{ color: 'var(--mute2)' }}>
        {value ? null : emptyHint}
      </span>
    </div>
  )
}

function formatRhs(value: LinkagePredicate | undefined): string {
  if (!value) return ''
  const v = value.value
  if (Array.isArray(v)) return v.join(', ')
  if (v == null) return ''
  return String(v)
}

function parseRhs(raw: string, op: LinkagePredicate['op']): unknown {
  if (op === 'in' || op === 'notIn') {
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  }
  if (op === 'gte' || op === 'lte') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : raw
  }
  return raw
}
