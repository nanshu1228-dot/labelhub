'use client'

import {
  SelectRow,
  TextRow,
} from '@/components/form-designer/properties/primitives'
import type { Material } from './types'

/**
 * ShowItem — Spec 4.2 calls it out by name. Renders the topic's raw
 * data (the question / prompt / reference content) so the Labeler can
 * read it while answering. Does NOT participate in submission.
 *
 * `sourcePath` is a dotted accessor into the topic's `item_data` jsonb
 * (e.g. "prompt", "reference.text"). D6 Renderer resolves it.
 */
type ShowItemConfig = {
  sourcePath?: string
  renderAs?: 'plain' | 'markdown' | 'code' | 'image' | 'json'
}

export const showItemFieldMaterial: Material = {
  kind: 'show-item',
  name: 'Show item',
  icon: '👁',
  defaultConfig: {
    sourcePath: 'prompt',
    /** Render mode — plain text vs markdown vs preformatted code. */
    renderAs: 'markdown',
  } satisfies ShowItemConfig,
  designerPreview: ({ field }) => {
    const cfg = field.config as ShowItemConfig
    return (
      <div
        className="rounded p-3 ts-13"
        style={{
          background: 'oklch(0.6 0.18 280 / 0.05)',
          border: '1px solid oklch(0.6 0.18 280 / 0.3)',
          color: 'var(--text)',
          cursor: 'grab',
        }}
      >
        <div
          className="lh-mono lh-caption mb-1"
          style={{ color: 'oklch(0.6 0.18 280)' }}
        >
          § SHOW · sourcePath: {cfg.sourcePath ?? 'prompt'}
        </div>
        <div style={{ color: 'var(--mute)' }}>
          [Renderer hydrates topic.itemData.{cfg.sourcePath ?? 'prompt'}{' '}
          here at runtime · {cfg.renderAs ?? 'markdown'}]
        </div>
      </div>
    )
  },
  propertyPanel: ({ field, onChange }) => {
    const cfg = field.config as ShowItemConfig
    function patch(next: Partial<ShowItemConfig>) {
      onChange({ ...field, config: { ...cfg, ...next } })
    }
    return (
      <>
        <TextRow
          label="Source path"
          hint="Dotted accessor into topic.itemData (e.g. prompt, reference.text)."
          value={cfg.sourcePath ?? ''}
          onChange={(v) => patch({ sourcePath: v })}
          placeholder="prompt"
        />
        <SelectRow
          label="Render as"
          value={cfg.renderAs ?? 'markdown'}
          onChange={(v) => patch({ renderAs: v })}
          options={[
            { value: 'plain', label: 'Plain text' },
            { value: 'markdown', label: 'Markdown' },
            { value: 'code', label: 'Code block' },
            { value: 'json', label: 'JSON' },
            { value: 'image', label: 'Image (URL or data URI)' },
          ]}
        />
      </>
    )
  },
}
