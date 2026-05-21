'use client'

/**
 * Common property rows — Finals P1 D4.
 *
 * Every material's propertyPanel starts with the same three rows:
 *
 *   1. CommonFieldHeader — label + helperText + delete button
 *   2. ValidationListEditor — shared `field.validation` rules
 *
 * Per-material specifics (options, accept, maxLength) live in each
 * material file. This isolation means adding a 10th material reuses
 * these rows directly.
 */

import type { FieldNode, ValidationRule } from '@/lib/form-designer/schema'
import { FieldRow, NumberRow, TextRow } from '@/components/form-materials/primitives'

export function CommonFieldHeader({
  field,
  onChange,
  onDelete,
}: {
  field: FieldNode
  onChange: (next: FieldNode) => void
  onDelete: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <TextRow
        label="Label"
        value={field.label}
        onChange={(label) => onChange({ ...field, label })}
        placeholder="Field label shown to Labelers"
      />
      <TextRow
        label="Helper text"
        value={field.helperText ?? ''}
        onChange={(v) =>
          onChange({ ...field, helperText: v || undefined })
        }
        placeholder="Optional one-line hint"
      />
      <div
        className="ts-11 mono"
        style={{ color: 'var(--mute2)' }}
      >
        ID: <code>{field.id}</code>
        <br />
        Kind: <code>{field.kind}</code>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="ts-12 mono px-3 py-1.5 rounded self-start"
        style={{
          background: 'transparent',
          color: 'var(--danger)',
          border: '1px solid oklch(0.55 0.2 25 / 0.4)',
          cursor: 'pointer',
        }}
      >
        Delete field
      </button>
    </div>
  )
}

/**
 * Validation rule list editor. Add / edit / remove rules; commits a
 * fresh `validation` array on every change. Required is rendered as a
 * dedicated checkbox row so common cases don't need to dropdown-add.
 */
export function ValidationListEditor({
  field,
  onChange,
}: {
  field: FieldNode
  onChange: (next: FieldNode) => void
}) {
  const rules = field.validation
  const required = rules.some((r) => r.kind === 'required')

  function setRules(next: ValidationRule[]) {
    onChange({ ...field, validation: next })
  }

  function toggleRequired(on: boolean) {
    const without = rules.filter((r) => r.kind !== 'required')
    setRules(on ? [{ kind: 'required' }, ...without] : without)
  }

  function patchAt(idx: number, next: ValidationRule) {
    setRules(rules.map((r, i) => (i === idx ? next : r)))
  }

  function removeAt(idx: number) {
    setRules(rules.filter((_, i) => i !== idx))
  }

  function addRule(kind: ValidationRule['kind']) {
    const fresh: ValidationRule =
      kind === 'required'
        ? { kind: 'required' }
        : kind === 'min-length'
          ? { kind: 'min-length', value: 1 }
          : kind === 'max-length'
            ? { kind: 'max-length', value: 200 }
            : kind === 'regex'
              ? { kind: 'regex', pattern: '.*' }
              : kind === 'min'
                ? { kind: 'min', value: 0 }
                : { kind: 'max', value: 100 }
    setRules([...rules, fresh])
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="lh-mono lh-caption"
        style={{ color: 'var(--mute)' }}
      >
        VALIDATION
      </div>
      <label
        className="ts-12 inline-flex items-center gap-2"
        style={{ cursor: 'pointer' }}
      >
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => toggleRequired(e.target.checked)}
          style={{ accentColor: 'oklch(0.6 0.18 280)' }}
        />
        Required
      </label>
      <ul className="flex flex-col gap-2">
        {rules.map((r, idx) => {
          if (r.kind === 'required') return null
          return (
            <li key={idx} className="flex items-center gap-1.5">
              <span
                className="ts-11 mono"
                style={{ width: 90, color: 'var(--mute2)' }}
              >
                {r.kind}
              </span>
              {r.kind === 'regex' ? (
                <input
                  type="text"
                  defaultValue={r.pattern}
                  onBlur={(e) =>
                    patchAt(idx, { kind: 'regex', pattern: e.target.value })
                  }
                  placeholder=".*"
                  className="ts-12 mono flex-1"
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    padding: '4px 8px',
                    color: 'var(--text)',
                  }}
                />
              ) : (
                <input
                  type="number"
                  defaultValue={r.value}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (!Number.isFinite(n)) return
                    if (r.kind === 'min-length' || r.kind === 'max-length') {
                      patchAt(idx, {
                        kind: r.kind,
                        value: Math.max(0, Math.floor(n)),
                      })
                    } else {
                      patchAt(idx, { kind: r.kind, value: n })
                    }
                  }}
                  className="ts-12 mono flex-1"
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    padding: '4px 8px',
                    color: 'var(--text)',
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="ts-11 mono px-2 py-1 rounded"
                style={{
                  background: 'transparent',
                  color: 'var(--danger)',
                  border: '1px solid oklch(0.55 0.2 25 / 0.4)',
                  cursor: 'pointer',
                }}
                aria-label="Remove rule"
              >
                ✕
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            'min-length',
            'max-length',
            'regex',
            'min',
            'max',
          ] as const
        ).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => addRule(k)}
            className="ts-11 mono px-2 py-1 rounded"
            style={{
              background: 'var(--panel2)',
              color: 'var(--text)',
              border: '1px solid var(--line)',
              cursor: 'pointer',
            }}
          >
            + {k}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Convenience re-export so material files only import from one place. */
export { NumberRow, TextRow, FieldRow }
