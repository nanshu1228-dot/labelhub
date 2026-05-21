'use client'

import {
  NumberRow,
  TagListRow,
  TextRow,
} from './primitives'
import type { Material } from './types'

/**
 * Rich-text editor. D6 Renderer will hydrate this with a real editor
 * (likely lexical or a thin contenteditable wrapper). The designer
 * preview is a static placeholder card so the canvas stays cheap.
 */
type RichTextConfig = {
  placeholder?: string
  minLength?: number | null
  maxLength?: number | null
  toolbar?: string[]
}

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
  } satisfies RichTextConfig,
  designerPreview: ({ field }) => {
    const cfg = field.config as RichTextConfig
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
  runtimeRenderer: ({ field, value, onChange, readOnly }) => {
    // D6 ships a plain-textarea fallback. A full WYSIWYG (lexical /
    // codemirror) is part of P6 polish — the form-renderer never
    // imports it directly, so the wrap is one component swap away.
    const cfg = field.config as RichTextConfig
    const v = typeof value === 'string' ? value : ''
    return (
      <textarea
        value={v}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder={cfg.placeholder ?? 'Write with formatting…'}
        rows={6}
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
    const cfg = field.config as RichTextConfig
    function patch(next: Partial<RichTextConfig>) {
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
          label="Min length"
          value={cfg.minLength ?? null}
          onChange={(v) => patch({ minLength: v })}
          min={0}
        />
        <NumberRow
          label="Max length"
          value={cfg.maxLength ?? null}
          onChange={(v) => patch({ maxLength: v })}
          min={0}
        />
        <TagListRow
          label="Toolbar"
          hint="bold, italic, underline, link, list, code, quote"
          value={cfg.toolbar ?? []}
          onChange={(toolbar) => patch({ toolbar })}
          placeholder="bold, italic, underline"
        />
      </>
    )
  },
}
