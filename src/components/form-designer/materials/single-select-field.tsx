import type { Material } from './types'

/**
 * Radio-style single-select. Owner defines options[]. D4 property
 * panel exposes options CRUD with inline add/remove rows.
 */
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
  },
  designerPreview: ({ field }) => {
    const cfg = field.config as {
      options?: Array<{ value: string; label: string }>
      layout?: 'vertical' | 'horizontal'
    }
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
}
