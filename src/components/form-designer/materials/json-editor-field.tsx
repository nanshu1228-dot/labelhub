import type { Material } from './types'

/**
 * Structured JSON input. D6 Renderer wires this to a Monaco / Codemirror
 * editor with JSON schema validation when `jsonSchema` is configured.
 * The canvas preview shows a static code-block stub.
 */
export const jsonEditorFieldMaterial: Material = {
  kind: 'json-editor',
  name: 'JSON',
  icon: '{ }',
  defaultConfig: {
    /** Optional JSON Schema (draft-07) to validate input. */
    jsonSchema: null,
    /** Pretty-print on blur. */
    formatOnBlur: true,
  },
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
}
