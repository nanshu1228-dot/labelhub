'use client'

import {
  TextRow,
  ToggleRow,
} from '@/components/form-designer/properties/primitives'
import type { Material } from './types'

/**
 * Structured JSON input. D6 Renderer wires this to a Monaco / Codemirror
 * editor with JSON schema validation when `jsonSchema` is configured.
 * The canvas preview shows a static code-block stub.
 */
type JsonEditorConfig = {
  jsonSchema?: unknown
  formatOnBlur?: boolean
}

export const jsonEditorFieldMaterial: Material = {
  kind: 'json-editor',
  name: 'JSON',
  icon: '{ }',
  defaultConfig: {
    /** Optional JSON Schema (draft-07) to validate input. */
    jsonSchema: null,
    /** Pretty-print on blur. */
    formatOnBlur: true,
  } satisfies JsonEditorConfig,
  designerPreview: () => (
    <pre
      className="ts-12 mono rounded"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        color: 'var(--mute)',
        padding: '8px 12px',
        margin: 0,
        cursor: 'grab',
        overflow: 'hidden',
      }}
    >
      {'{\n  "key": "value",\n  ...\n}'}
    </pre>
  ),
  propertyPanel: ({ field, onChange }) => {
    const cfg = field.config as JsonEditorConfig
    function patch(next: Partial<JsonEditorConfig>) {
      onChange({ ...field, config: { ...cfg, ...next } })
    }

    const schemaText =
      cfg.jsonSchema == null
        ? ''
        : (() => {
            try {
              return JSON.stringify(cfg.jsonSchema, null, 2)
            } catch {
              return ''
            }
          })()

    return (
      <>
        <ToggleRow
          label="Format on blur"
          hint="Pretty-print the editor contents when focus leaves the field."
          value={cfg.formatOnBlur ?? true}
          onChange={(v) => patch({ formatOnBlur: v })}
        />
        <TextRow
          label="JSON Schema"
          hint="Optional draft-07 schema. Empty = freeform JSON."
          value={schemaText}
          onChange={(raw) => {
            const trimmed = raw.trim()
            if (!trimmed) {
              patch({ jsonSchema: null })
              return
            }
            try {
              patch({ jsonSchema: JSON.parse(trimmed) })
            } catch {
              // Ignore — Renderer revalidates; the owner sees the bad
              // JSON in the textarea and corrects on next blur.
            }
          }}
          placeholder='{ "type": "object", ... }'
          multiline
        />
      </>
    )
  },
}
