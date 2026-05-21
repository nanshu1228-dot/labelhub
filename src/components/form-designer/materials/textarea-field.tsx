import type { Material } from './types'

/**
 * Multi-line text input. Used for free-form explanations, reasoning,
 * captions. maxLength defaults to 4000 (one Claude turn's worth).
 */
export const textareaFieldMaterial: Material = {
  kind: 'textarea',
  name: 'Textarea',
  icon: '¶',
  defaultConfig: {
    placeholder: '',
    maxLength: 4000,
    rows: 4,
  },
  designerPreview: ({ field }) => {
    const cfg = field.config as { placeholder?: string; rows?: number }
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
}
