'use client'

import {
  OptionListEditor,
  SelectRow,
  type OptionItem,
} from '@/components/form-designer/properties/primitives'
import type { Material } from './types'

/**
 * Radio-style single-select. Owner defines options[]. The property
 * panel exposes options CRUD via {@link OptionListEditor}.
 */
type SingleSelectConfig = {
  options?: OptionItem[]
  layout?: 'vertical' | 'horizontal'
}

export const singleSelectFieldMaterial: Material = {
  kind: 'single-select',
  name: 'Single select',
  icon: '◉',
  defaultConfig: {
    options: [
      { value: 'a', label: 'Option A' },
      { value: 'b', label: 'Option B' },
    ],
    layout: 'vertical',
  } satisfies SingleSelectConfig,
  designerPreview: ({ field }) => {
    const cfg = field.config as SingleSelectConfig
    const options = cfg.options ?? []
    return (
      <div
        className={`flex ${cfg.layout === 'horizontal' ? 'flex-row gap-4' : 'flex-col gap-1.5'}`}
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
            <label
              key={opt.value}
              className="ts-13 inline-flex items-center gap-2"
              style={{ color: 'var(--text)' }}
            >
              <input
                type="radio"
                name={`preview_${field.id}`}
                disabled
                style={{ accentColor: 'oklch(0.6 0.18 280)' }}
              />
              {opt.label}
            </label>
          ))
        )}
      </div>
    )
  },
  propertyPanel: ({ field, onChange }) => {
    const cfg = field.config as SingleSelectConfig
    function patch(next: Partial<SingleSelectConfig>) {
      onChange({ ...field, config: { ...cfg, ...next } })
    }
    return (
      <>
        <OptionListEditor
          options={cfg.options ?? []}
          onChange={(options) => patch({ options })}
        />
        <SelectRow
          label="Layout"
          value={cfg.layout ?? 'vertical'}
          onChange={(v) => patch({ layout: v })}
          options={[
            { value: 'vertical', label: 'Vertical (stacked)' },
            { value: 'horizontal', label: 'Horizontal (inline)' },
          ]}
        />
      </>
    )
  },
}
