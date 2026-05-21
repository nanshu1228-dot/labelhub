import type { Material } from './types'

/**
 * Checkbox / tag-style multi-select. Spec calls this out as 标签选择.
 * Owner sets minSelected / maxSelected to bound the answer count.
 */
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
  },
  designerPreview: ({ field }) => {
    const cfg = field.config as {
      options?: Array<{ value: string; label: string }>
    }
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
}
