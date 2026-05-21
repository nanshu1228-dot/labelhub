import type { Material } from './types'

/**
 * Single-line text input material. The simplest widget — placeholder
 * + maxLength + autocomplete config. Used for short factual answers
 * (names, URLs, identifiers).
 */
export const textFieldMaterial: Material = {
  kind: 'text',
  name: 'Text',
  icon: 'T',
  defaultConfig: {
    placeholder: '',
    maxLength: 200,
    autocomplete: 'off',
  },
  designerPreview: ({ field }) => {
    const cfg = field.config as { placeholder?: string }
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
}
