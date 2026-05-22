'use client'

import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  SelectRow,
  TextRow,
} from './primitives'
import type { Material, RuntimeRendererProps } from './types'

/**
 * ShowItem — Spec 4.2 calls it out by name. Renders the topic's raw
 * data (the question / prompt / reference content) so the Labeler can
 * read it while answering. Does NOT participate in submission.
 *
 * `sourcePath` is a dotted accessor into the topic's `item_data` jsonb
 * (e.g. "prompt", "reference.text"). The Renderer resolves it.
 *
 * D19 — `renderAs` gained `'video'` + `'auto'`. `'auto'` is the new
 * default; it inspects `value` and picks the right mode (covers the
 * official qa_quality dataset's text/image/video/markdown mix without
 * the PM having to configure each field). Explicit modes
 * (`'markdown'` / `'plain'` / `'image'` / `'code'` / `'json'`) still
 * work — only the default behavior changed.
 */
export type ShowItemRenderMode =
  | 'auto'
  | 'plain'
  | 'markdown'
  | 'code'
  | 'image'
  | 'video'
  | 'json'

type ShowItemConfig = {
  sourcePath?: string
  renderAs?: ShowItemRenderMode
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(?:\?|#|$)/i
const VIDEO_EXT_RE = /\.(mp4|webm|ogg|ogv|mov|m4v)(?:\?|#|$)/i
/**
 * Markdown markers that the auto-detector treats as "this is markdown":
 *   - line starts with `#` (heading)
 *   - line starts with `-` or `*` (list)
 *   - `**bold**`
 *   - `![alt](url)` image embed
 *   - `<video ...>` raw HTML video embed (qa_quality M0001 uses this)
 *   - fenced code block ``` ```
 */
const MARKDOWN_HINT_RE = /(^#\s)|(^\*\s)|(^-\s)|(\*\*[^*]+\*\*)|(!\[)|(<video\b)|(```)/m

/**
 * Pure helper — decide a concrete render mode for an arbitrary
 * `value`. Exported so tests + the seed script can pin the
 * classification.
 *
 * Rules (in order):
 *  - object / array → 'json'
 *  - string that looks like a video URL → 'video'
 *  - string that looks like an image URL OR data URI → 'image'
 *  - string with markdown markers → 'markdown'
 *  - anything else → 'plain'
 *
 * Never throws. Unknown / null input → 'plain'.
 */
export function detectShowItemRenderMode(value: unknown): ShowItemRenderMode {
  if (value == null) return 'plain'
  if (typeof value === 'object') return 'json'
  if (typeof value !== 'string') return 'plain'
  const trimmed = value.trim()
  if (!trimmed) return 'plain'
  // URL-ish detection — only consider http(s) or data: URIs.
  const isHttpUrl = /^https?:\/\//i.test(trimmed)
  const isImageDataUri = /^data:image\/[a-z+.-]+;/i.test(trimmed)
  if (isHttpUrl && VIDEO_EXT_RE.test(trimmed)) return 'video'
  if (isHttpUrl && IMAGE_EXT_RE.test(trimmed)) return 'image'
  if (isImageDataUri) return 'image'
  if (MARKDOWN_HINT_RE.test(trimmed)) return 'markdown'
  return 'plain'
}

/**
 * Safe-URL whitelist for media. Returns the original URL when safe,
 * otherwise null. Rejects `javascript:`, `data:` for non-image
 * targets, and any other scheme. Used by the video branch (image
 * branch tolerates data: URIs because they're explicit and
 * verifiably bytes).
 */
function safeMediaUrl(url: string): string | null {
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return null
}

export function ShowItemRuntime({
  field,
  value,
}: RuntimeRendererProps) {
  // The Renderer passes the resolved topic value (looked up via
  // cfg.sourcePath) as `value`. ShowItem never participates in
  // submission — onChange is intentionally unused.
  const cfg = field.config as ShowItemConfig
  const configured = cfg.renderAs ?? 'auto'
  const renderAs: ShowItemRenderMode =
    configured === 'auto' ? detectShowItemRenderMode(value) : configured

  // Memoize the markdown-parse tree per `value` — AGENTS.md perf
  // rule "memoize markdown render output per row". The rendered tree
  // is React elements; the cheap cache key is the raw string.
  const markdownNode = useMemo(() => {
    if (renderAs !== 'markdown' || typeof value !== 'string') return null
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(href) => {
          // Allow http(s) + relative refs (Markdown anchors). Block
          // javascript: / vbscript: / file: URLs.
          if (!href) return ''
          if (/^(javascript|vbscript|file):/i.test(href)) return ''
          return href
        }}
        components={{
          // Constrain images so they don't blow out the form
          // layout; align with the explicit 'image' branch.
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          img: ({ node: _node, ...props }) => (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img
              {...props}
              style={{
                maxWidth: '100%',
                borderRadius: 4,
                ...(props.style ?? {}),
              }}
            />
          ),
        }}
      >
        {value}
      </ReactMarkdown>
    )
  }, [renderAs, value])

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

  if (renderAs === 'video' && typeof value === 'string') {
    const safe = safeMediaUrl(value)
    if (!safe) {
      return (
        <div
          className="ts-12"
          style={{ color: 'var(--mute2)' }}
        >
          (blocked video URL — http(s) only)
        </div>
      )
    }
    return (
      <video
        src={safe}
        controls
        preload="metadata"
        style={{ maxWidth: '100%', borderRadius: 4 }}
      />
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

  if (renderAs === 'markdown' && markdownNode) {
    return (
      <div
        className="ts-13"
        style={{ color: 'var(--text)', lineHeight: 1.55 }}
      >
        {markdownNode}
      </div>
    )
  }

  // plain text fallback (also catches typeof value !== 'string' for
  // markdown/image/video branches that didn't render).
  return (
    <div
      className="ts-13"
      style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}
    >
      {typeof value === 'string' ? value : String(value)}
    </div>
  )
}

export const showItemFieldMaterial: Material = {
  kind: 'show-item',
  name: 'Show item',
  icon: '👁',
  defaultConfig: {
    sourcePath: 'prompt',
    /** D19 — 'auto' is the new default. Detects video / image /
     *  markdown / json / plain from `value` automatically. */
    renderAs: 'auto',
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
          here at runtime · {cfg.renderAs ?? 'auto'}]
        </div>
      </div>
    )
  },
  runtimeRenderer: ShowItemRuntime,
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
          hint="Auto inspects the value and picks one of the modes below."
          value={cfg.renderAs ?? 'auto'}
          onChange={(v) => patch({ renderAs: v })}
          options={[
            { value: 'auto', label: 'Auto (detect from value)' },
            { value: 'plain', label: 'Plain text' },
            { value: 'markdown', label: 'Markdown (with images / video)' },
            { value: 'code', label: 'Code block' },
            { value: 'json', label: 'JSON' },
            { value: 'image', label: 'Image (URL or data URI)' },
            { value: 'video', label: 'Video (mp4 / webm)' },
          ]}
        />
      </>
    )
  },
}
