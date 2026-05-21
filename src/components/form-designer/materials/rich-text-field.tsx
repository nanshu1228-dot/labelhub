import type { Material } from './types'

/**
 * Rich-text editor. D6 Renderer will hydrate this with a real editor
 * (likely lexical or a thin contenteditable wrapper). The designer
 * preview is a static placeholder card so the canvas stays cheap.
 */
export const richTextFieldMaterial: Material = {
  kind: 'rich-text',
  name: 'Rich text',
  icon: '𝐁',
  defaultConfig: {
    placeholder: 'Write with formatting…',
    minLength: 0,
    maxLength: 8000,
    /** Which toolbar groups to expose. D6 wires these into the editor. */
    toolbar: ['bold', 'italic', 'underline', 'link', 'list'],
  },
  designerPreview: ({ field }) => {
    const cfg = field.config as { placeholder?: string }
    return (
      <div
        className="rounded ts-13"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          color: 'var(--mute2)',
          cursor: 'grab',
        }}
      >
        <div
          className="px-2 py-1 lh-mono lh-caption flex items-center gap-2"
          style={{
            borderBottom: '1px solid var(--line)',
            color: 'var(--mute)',
          }}
        >
          <span style={{ fontWeight: 700 }}>B</span>
          <span style={{ fontStyle: 'italic' }}>I</span>
          <span style={{ textDecoration: 'underline' }}>U</span>
          <span>·</span>
          <span>🔗</span>
          <span>•</span>
        </div>
        <div className="px-3 py-3" style={{ minHeight: 60 }}>
          {cfg.placeholder ?? 'Write with formatting…'}
        </div>
      </div>
    )
  },
}
