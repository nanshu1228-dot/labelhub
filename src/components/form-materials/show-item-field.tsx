'use client'

import { useMemo, type ReactNode } from 'react'
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

/**
 * Module-level LRU cache for the markdown render output — D20-C.
 *
 * Without this, each ShowItem instance has its own useMemo cache.
 * When the same content (e.g. the seed dataset's duplicated prompts
 * across markdown rows) shows up in N ShowItems on the same page,
 * react-markdown's tree-build runs N times. The LRU shares the
 * compiled React tree across instances; subsequent renders return
 * the cached node directly.
 *
 * Bounded size 50 — well past the seed's realistic duplicate count.
 * Eviction is naive FIFO (Map preserves insertion order); good
 * enough for a presentational cache.
 */
const MARKDOWN_CACHE = new Map<string, ReactNode>()
const MARKDOWN_CACHE_LIMIT = 50

function renderMarkdownCached(source: string): ReactNode {
  const cached = MARKDOWN_CACHE.get(source)
  if (cached !== undefined) return cached
  const node: ReactNode = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(href) => {
        if (!href) return ''
        if (/^(javascript|vbscript|file):/i.test(href)) return ''
        return href
      }}
      components={{
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
      {source}
    </ReactMarkdown>
  )
  if (MARKDOWN_CACHE.size >= MARKDOWN_CACHE_LIMIT) {
    // FIFO eviction — drop the oldest entry.
    const oldest = MARKDOWN_CACHE.keys().next().value
    if (oldest !== undefined) MARKDOWN_CACHE.delete(oldest)
  }
  MARKDOWN_CACHE.set(source, node)
  return node
}

/**
 * Test-only: clear the markdown LRU cache between tests so the
 * cache state doesn't leak across files.
 */
export function _resetMarkdownCacheForTests(): void {
  MARKDOWN_CACHE.clear()
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

  // D20-C — the markdown tree is now cached in a module-level LRU
  // shared across instances. useMemo here returns the cached node
  // identity for the same source string, so multiple ShowItems
  // rendering the same content (e.g. duplicated prompts across
  // seed dataset rows) reuse one compiled tree.
  const markdownNode = useMemo(() => {
    if (renderAs !== 'markdown' || typeof value !== 'string') return null
    return renderMarkdownCached(value)
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
