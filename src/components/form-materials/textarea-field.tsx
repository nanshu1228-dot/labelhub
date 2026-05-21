'use client'

import {
  NumberRow,
  TextRow,
} from './primitives'
import type { Material } from './types'

/**
 * Multi-line text input. Used for free-form explanations, reasoning,
 * captions. maxLength defaults to 4000 (one Claude turn's worth).
 */
type TextareaConfig = {
  placeholder?: string
  maxLength?: number | null
  rows?: number
}

export const textareaFieldMaterial: Material = {
  kind: 'textarea',
  name: 'Textarea',
  icon: '¶',
  defaultConfig: {
    placeholder: '',
    maxLength: 4000,
    rows: 4,
  } satisfies TextareaConfig,
  designerPreview: ({ field }) => {
    const cfg = field.config as TextareaConfig
    return (
      <textarea
        readOnly
        placeholder={cfg.placeholder || 'Multi-line text'}
        rows={cfg.rows ?? 4}
        className="w-full ts-13 resize-none"
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
    const cfg = field.config as TextareaConfig
    const v = typeof value === 'string' ? value : ''
    return (
      <textarea
        value={v}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder={cfg.placeholder}
        rows={cfg.rows ?? 4}
        maxLength={cfg.maxLength ?? undefined}
        className="w-full ts-13 resize-y"
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
    const cfg = field.config as TextareaConfig
    function patch(next: Partial<TextareaConfig>) {
      onChange({ ...field, config: { ...cfg, ...next } })
    }
    return (
      <>
        <TextRow
          label="Placeholder"
          value={cfg.placeholder ?? ''}
          onChange={(v) => patch({ placeholder: v })}
        />
        <NumberRow
          label="Visible rows"
          value={cfg.rows ?? 4}
          onChange={(v) => patch({ rows: v ?? 4 })}
          min={1}
        />
        <NumberRow
          label="Max length"
          value={cfg.maxLength ?? null}
          onChange={(v) => patch({ maxLength: v })}
          min={0}
          placeholder="No limit"
        />
      </>
    )
  },
}
