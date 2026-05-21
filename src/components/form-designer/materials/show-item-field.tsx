import type { Material } from './types'

/**
 * ShowItem — Spec 4.2 calls it out by name. Renders the topic's raw
 * data (the question / prompt / reference content) so the Labeler can
 * read it while answering. Does NOT participate in submission.
 *
 * `sourcePath` is a dotted accessor into the topic's `item_data` jsonb
 * (e.g. "prompt", "reference.text"). D6 Renderer resolves it.
 */
export const showItemFieldMaterial: Material = {
  kind: 'show-item',
  name: 'Show item',
  icon: '👁',
  defaultConfig: {
    sourcePath: 'prompt',
    /** Render mode — plain text vs markdown vs preformatted code. */
    renderAs: 'markdown',
  },
  designerPreview: ({ field }) => {
    const cfg = field.config as { sourcePath?: string; renderAs?: string }
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
}
