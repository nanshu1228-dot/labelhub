'use client'

import {
  NumberRow,
  SelectRow,
  TextRow,
} from './primitives'
import type { Material } from './types'

/**
 * Single-line text input material. The simplest widget — placeholder
 * + maxLength + autocomplete config. Used for short factual answers
 * (names, URLs, identifiers).
 */
type TextConfig = {
  placeholder?: string
  maxLength?: number | null
  autocomplete?: 'off' | 'on' | 'email' | 'url'
}

export const textFieldMaterial: Material = {
  kind: 'text',
  name: 'Text',
  icon: 'T',
  defaultConfig: {
    placeholder: '',
    maxLength: 200,
    autocomplete: 'off',
  } satisfies TextConfig,
  designerPreview: ({ field }) => {
    const cfg = field.config as TextConfig
    return (
      <input
        type="text"
        readOnly
        placeholder={cfg.placeholder || 'Single-line input'}
        className="w-full ts-13"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          padding: '6px 10px',
          color: 'var(--text)',
          cursor: 'grab',
        }}
      />
    )
  },
  runtimeRenderer: ({ field, value, onChange, readOnly }) => {
    const cfg = field.config as TextConfig
    const v = typeof value === 'string' ? value : ''
    return (
      <input
        type="text"
        value={v}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder={cfg.placeholder}
        maxLength={cfg.maxLength ?? undefined}
        autoComplete={cfg.autocomplete}
        className="w-full ts-13"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 4,
          padding: '6px 10px',
          color: 'var(--text)',
        }}
      />
    )
  },
  propertyPanel: ({ field, onChange }) => {
    const cfg = field.config as TextConfig
    function patch(next: Partial<TextConfig>) {
      onChange({ ...field, config: { ...cfg, ...next } })
    }
    return (
      <>
        <TextRow
          label="Placeholder"
          value={cfg.placeholder ?? ''}
          onChange={(v) => patch({ placeholder: v })}
          placeholder="Hint shown inside the field"
        />
        <NumberRow
          label="Max length"
          value={cfg.maxLength ?? null}
          onChange={(v) => patch({ maxLength: v })}
          min={0}
          placeholder="No limit"
        />
        <SelectRow
          label="Autocomplete"
          value={cfg.autocomplete ?? 'off'}
          onChange={(v) => patch({ autocomplete: v })}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
            { value: 'email', label: 'Email' },
            { value: 'url', label: 'URL' },
          ]}
        />
      </>
    )
  },
}
