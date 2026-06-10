'use client'

import {
  NumberRow,
  OptionListEditor,
  type OptionItem,
} from './primitives'
import type { Material } from './types'

/**
 * Checkbox-style multi-select. Tag chips live in `tag-select-field`.
 * Owner sets minSelected / maxSelected to bound the answer count.
 */
type MultiSelectConfig = {
  options?: OptionItem[]
  minSelected?: number | null
  maxSelected?: number | null
}

export const multiSelectFieldMaterial: Material = {
  kind: 'multi-select',
  name: 'Multi-select',
  icon: '☑',
  defaultConfig: {
    options: [
      { value: 'tag1', label: 'Tag 1' },
      { value: 'tag2', label: 'Tag 2' },
      { value: 'tag3', label: 'Tag 3' },
    ],
    minSelected: 0,
    maxSelected: null,
  } satisfies MultiSelectConfig,
  designerPreview: ({ field }) => {
    const cfg = field.config as MultiSelectConfig
    const options = cfg.options ?? []
    return (
      <div
        className="flex flex-wrap gap-2"
        style={{ cursor: 'grab' }}
      >
        {options.length === 0 ? (
          <span
            className="ts-12"
            style={{ color: 'var(--mute2)' }}
          >
            No options configured
          </span>
        ) : (
          options.map((opt) => (
            <span
              key={opt.value}
              className="ts-12 mono px-2 py-1 rounded"
              style={{
                background: 'var(--panel2)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
              }}
            >
              ☐ {opt.label}
            </span>
          ))
        )}
      </div>
    )
  },
  runtimeRenderer: ({ field, value, onChange, readOnly }) => {
    const cfg = field.config as MultiSelectConfig
    const options = cfg.options ?? []
    const selected: string[] = Array.isArray(value) ? (value as string[]) : []
    function toggle(v: string) {
      if (readOnly) return
      if (selected.includes(v)) {
        onChange(selected.filter((x) => x !== v))
      } else {
        const max = cfg.maxSelected ?? Number.POSITIVE_INFINITY
        if (selected.length >= max) return
        onChange([...selected, v])
      }
    }
    return (
      <div className="flex flex-wrap gap-2">
        {options.length === 0 ? (
          <span
            className="ts-12"
            style={{ color: 'var(--mute2)' }}
          >
            No options configured
          </span>
        ) : (
          options.map((opt) => {
            const on = selected.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                disabled={readOnly}
                className="ts-12 mono px-2 py-1 rounded"
                style={{
                  background: on ? 'var(--accent-soft)' : 'var(--panel2)',
                  border: `1px solid ${on ? 'var(--accent-line)' : 'var(--line)'}`,
                  color: 'var(--text)',
                  cursor: readOnly ? 'default' : 'pointer',
                }}
              >
                {on ? '☑' : '☐'} {opt.label}
              </button>
            )
          })
        )}
      </div>
    )
  },
  propertyPanel: ({ field, onChange }) => {
    const cfg = field.config as MultiSelectConfig
    function patch(next: Partial<MultiSelectConfig>) {
      onChange({ ...field, config: { ...cfg, ...next } })
    }
    return (
      <>
        <OptionListEditor
          options={cfg.options ?? []}
          onChange={(options) => patch({ options })}
        />
        <NumberRow
          label="Min selected"
          value={cfg.minSelected ?? null}
          onChange={(v) => patch({ minSelected: v })}
          min={0}
          placeholder="0"
        />
        <NumberRow
          label="Max selected"
          value={cfg.maxSelected ?? null}
          onChange={(v) => patch({ maxSelected: v })}
          min={1}
          placeholder="No limit"
        />
      </>
    )
  },
}
