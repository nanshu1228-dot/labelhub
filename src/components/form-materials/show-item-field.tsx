'use client'

import {
  SelectRow,
  TextRow,
} from './primitives'
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
  runtimeRenderer: ({ field, value }) => {
    // The Renderer passes the resolved topic value (looked up via
    // cfg.sourcePath) as `value`. ShowItem never participates in
    // submission — onChange is intentionally unused.
    const cfg = field.config as ShowItemConfig
    const renderAs = cfg.renderAs ?? 'markdown'
    if (value == null) {
      return (
        <div
          className="ts-12"
          style={{ color: 'var(--mute2)' }}
        >
          (no content at <code>{cfg.sourcePath ?? 'prompt'}</code>)
        </div>
      )
    }
    if (renderAs === 'code' || renderAs === 'json') {
      const text =
        typeof value === 'string'
          ? value
          : (() => {
              try {
                return JSON.stringify(value, null, 2)
              } catch {
                return String(value)
              }
            })()
      return (
        <pre
          className="ts-12 mono rounded"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
            padding: '8px 12px',
            margin: 0,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {text}
        </pre>
      )
    }
    if (renderAs === 'image' && typeof value === 'string') {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt={field.label}
          style={{ maxWidth: '100%', borderRadius: 4 }}
        />
      )
    }
    // plain or markdown — D6 ships plain text; full markdown render
    // joins the Renderer in P5 (Labeler workbench polish reuses the
    // existing markdown component).
    return (
      <div
        className="ts-13"
        style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}
      >
        {String(value)}
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
