'use client'

/**
 * Property-panel row primitives — Finals P1 D4.
 *
 * Each material's `propertyPanel` composes these instead of hand-rolling
 * inputs. Keeps the right pane visually consistent and isolates the
 * "neutral palette + mono caption" treatment to one file.
 *
 * All primitives are uncontrolled-friendly: parent owns the value and a
 * `onChange(next)` callback; primitive only fires on blur/commit-style
 * events so a keystroke-heavy form doesn't thrash the canvas state.
 * (Pillar 4 perf rule: text inputs autosave on blur, never on every key.)
 */

import { useEffect, useState, type ReactNode } from 'react'

export function FieldRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="ts-12 flex flex-col gap-1">
      <span
        className="lh-mono lh-caption"
        style={{ color: 'var(--mute)' }}
      >
        {label.toUpperCase()}
      </span>
      {children}
      {hint ? (
        <span
          className="ts-11"
          style={{ color: 'var(--mute2)' }}
        >
          {hint}
        </span>
      ) : null}
    </label>
  )
}

/**
 * Free-text row. Commits on blur (not on keystroke) so the canvas atom
 * isn't re-projected once per key.
 */
export function TextRow({
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string
  hint?: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  const [local, setLocal] = useState(value)
  // Re-sync if parent swaps the field (selection change).
  useEffect(() => {
    setLocal(value)
  }, [value])

  const sharedStyle = {
    background: 'var(--bg)',
    border: '1px solid var(--line)',
    borderRadius: 4,
    padding: '6px 10px',
    color: 'var(--text)',
  } as const

  return (
    <FieldRow label={label} hint={hint}>
      {multiline ? (
        <textarea
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => local !== value && onChange(local)}
          placeholder={placeholder}
          rows={3}
          className="w-full ts-13 resize-y"
          style={sharedStyle}
        />
      ) : (
        <input
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => local !== value && onChange(local)}
          placeholder={placeholder}
          className="w-full ts-13"
          style={sharedStyle}
        />
      )}
    </FieldRow>
  )
}

/**
 * Integer number row. `null` / undefined means "no limit"; the input
 * renders empty in that case and clears via empty string.
 */
export function NumberRow({
  label,
  hint,
  value,
  onChange,
  min,
  step = 1,
  placeholder,
}: {
  label: string
  hint?: string
  value: number | null | undefined
  onChange: (next: number | null) => void
  min?: number
  step?: number
  placeholder?: string
}) {
  const [local, setLocal] = useState<string>(
    value == null ? '' : String(value),
  )
  useEffect(() => {
    setLocal(value == null ? '' : String(value))
  }, [value])

  function commit() {
    if (local.trim() === '') {
      if (value != null) onChange(null)
      return
    }
    const n = Number(local)
    if (Number.isFinite(n) && n !== value) onChange(n)
  }

  return (
    <FieldRow label={label} hint={hint}>
      <input
        type="number"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        min={min}
        step={step}
        placeholder={placeholder}
        className="w-full ts-13 mono"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          padding: '6px 10px',
          color: 'var(--text)',
        }}
      />
    </FieldRow>
  )
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label
      className="ts-12 flex items-center justify-between gap-3"
      style={{ cursor: 'pointer' }}
    >
      <span className="flex flex-col gap-0.5">
        <span
          className="lh-mono lh-caption"
          style={{ color: 'var(--mute)' }}
        >
          {label.toUpperCase()}
        </span>
        {hint ? (
          <span
            className="ts-11"
            style={{ color: 'var(--mute2)' }}
          >
            {hint}
          </span>
        ) : null}
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'oklch(0.6 0.18 280)' }}
      />
    </label>
  )
}

/**
 * Select row from a fixed list. Use for layout flags / render modes —
 * not for runtime options[] (that's OptionListEditor below).
 */
export function SelectRow<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string
  hint?: string
  value: T
  onChange: (next: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
}) {
  return (
    <FieldRow label={label} hint={hint}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full ts-13"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          padding: '6px 10px',
          color: 'var(--text)',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldRow>
  )
}

/**
 * Options CRUD editor — Single / multi-select use this. Adds, deletes,
 * and edits {value,label} pairs. value is normalized via slugify so
 * the JSON Schema enum stays clean.
 */
export type OptionItem = { value: string; label: string }

export function OptionListEditor({
  options,
  onChange,
}: {
  options: OptionItem[]
  onChange: (next: OptionItem[]) => void
}) {
  function patch(idx: number, next: Partial<OptionItem>) {
    onChange(
      options.map((o, i) => (i === idx ? { ...o, ...next } : o)),
    )
  }
  function remove(idx: number) {
    onChange(options.filter((_, i) => i !== idx))
  }
  function add() {
    const idx = options.length + 1
    onChange([
      ...options,
      { value: `opt_${idx}`, label: `Option ${idx}` },
    ])
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="lh-mono lh-caption"
        style={{ color: 'var(--mute)' }}
      >
        OPTIONS
      </div>
      <ul className="flex flex-col gap-1.5">
        {options.length === 0 ? (
          <li
            className="ts-12"
            style={{ color: 'var(--mute2)' }}
          >
            No options — add at least one.
          </li>
        ) : (
          options.map((opt, idx) => (
            <li
              key={`${idx}_${opt.value}`}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                defaultValue={opt.value}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== opt.value) patch(idx, { value: v })
                }}
                placeholder="value"
                className="ts-12 mono"
                style={{
                  width: '30%',
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: 'var(--text)',
                }}
              />
              <input
                type="text"
                defaultValue={opt.label}
                onBlur={(e) => {
                  const v = e.target.value
                  if (v !== opt.label) patch(idx, { label: v })
                }}
                placeholder="label"
                className="ts-12"
                style={{
                  flex: 1,
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: 'var(--text)',
                }}
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                className="ts-11 mono px-2 py-1 rounded"
                style={{
                  background: 'transparent',
                  color: 'var(--danger)',
                  border: '1px solid oklch(0.55 0.2 25 / 0.4)',
                  cursor: 'pointer',
                }}
                aria-label={`Remove option ${opt.label}`}
              >
                ✕
              </button>
            </li>
          ))
        )}
      </ul>
      <button
        type="button"
        onClick={add}
        className="ts-12 mono px-2 py-1 rounded self-start"
        style={{
          background: 'var(--panel2)',
          color: 'var(--text)',
          border: '1px solid var(--line)',
          cursor: 'pointer',
        }}
      >
        + Add option
      </button>
    </div>
  )
}

/**
 * Comma-separated tag editor for short token lists (file accept[],
 * toolbar groups, etc.). One textbox; split on comma; trim empties.
 */
export function TagListRow({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const [local, setLocal] = useState(value.join(', '))
  useEffect(() => {
    setLocal(value.join(', '))
  }, [value])

  function commit() {
    const next = local
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (
      next.length !== value.length ||
      next.some((t, i) => t !== value[i])
    ) {
      onChange(next)
    }
  }

  return (
    <FieldRow label={label} hint={hint ?? 'Comma-separated'}>
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        placeholder={placeholder}
        className="w-full ts-13 mono"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          padding: '6px 10px',
          color: 'var(--text)',
        }}
      />
    </FieldRow>
  )
}
