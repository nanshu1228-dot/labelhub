'use client'

import { useRef, useState } from 'react'
import {
  Bold,
  Code2,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  PencilLine,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import {
  NumberRow,
  TagListRow,
  TextRow,
} from './primitives'
import type { Material, RuntimeRendererProps } from './types'

/**
 * Rich-text editor (spec 4.2 富文本编辑器).
 *
 * The stored value is a **markdown string** — the same value/onChange
 * contract the plain textarea used, so serialize/validation and the
 * Renderer wiring are untouched. The internal UX is a real markdown
 * editor: a formatting toolbar (heading / bold / italic / code / list /
 * link) over a Write/Preview tab pair. Preview goes through
 * react-markdown + rehype-sanitize + remark-gfm with a urlTransform that
 * strips javascript:/vbscript:/file: hrefs, mirroring the
 * GuidelinesMarkdownEditor in task-admin/create-task-form-parts.tsx.
 *
 * The designer-canvas preview stays a cheap static card.
 */
type RichTextConfig = {
  placeholder?: string
  minLength?: number | null
  maxLength?: number | null
  toolbar?: string[]
}

/** Shared sanitized markdown preview — reused by runtime + read-only. */
function MarkdownPreview({ value, empty }: { value: string; empty: string }) {
  return (
    <div className="rich-text-preview task-guidelines-preview" style={{ minHeight: 120 }}>
      {value.trim() ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          urlTransform={(href) => {
            if (!href) return ''
            if (/^(javascript|vbscript|file):/i.test(href)) return ''
            return href
          }}
          components={{
            a: (props) => {
              const { node, ...linkProps } = props
              void node
              return <a {...linkProps} target="_blank" rel="noreferrer" />
            },
          }}
        >
          {value}
        </ReactMarkdown>
      ) : (
        <p className="ts-13" style={{ color: 'var(--mute2)' }}>
          {empty}
        </p>
      )}
    </div>
  )
}

const toolButtonStyle = {
  background: 'transparent',
  border: '1px solid var(--line)',
  borderRadius: 5,
  color: 'var(--mute)',
  cursor: 'pointer',
  height: 28,
  width: 30,
} as const

/**
 * Runtime markdown editor. Extracted to a named component (not an inline
 * arrow on the Material object) because it uses hooks. Props are exactly
 * the RuntimeRendererProps the Renderer passes — only field/value/
 * onChange/readOnly are consumed here.
 */
function RichTextRuntime({ field, value, onChange, readOnly }: RuntimeRendererProps) {
  const cfg = field.config as RichTextConfig
  const v = typeof value === 'string' ? value : ''
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mode, setMode] = useState<'write' | 'preview'>('write')

  // Read-only (e.g. reviewer viewing a submitted annotation): show the
  // sanitized rendered markdown, never an editable textarea. No onChange
  // is ever called, so the value contract is preserved.
  if (readOnly) {
    return (
      <div
        className="rounded-md overflow-hidden"
        style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}
      >
        <MarkdownPreview value={v} empty="No content." />
      </div>
    )
  }

  function replaceSelection(
    nextValue: string,
    selectionStart: number,
    selectionEnd: number,
  ) {
    onChange(nextValue)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(selectionStart, selectionEnd)
    })
  }

  function wrapSelection(prefix: string, suffix: string, fallback: string) {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? v.length
    const end = textarea?.selectionEnd ?? v.length
    const selected = v.slice(start, end) || fallback
    const nextValue =
      v.slice(0, start) + prefix + selected + suffix + v.slice(end)
    const innerStart = start + prefix.length
    replaceSelection(nextValue, innerStart, innerStart + selected.length)
  }

  function insertHeading() {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? v.length
    const end = textarea?.selectionEnd ?? v.length
    const selected = v.slice(start, end)
    const prefix = start > 0 && v[start - 1] !== '\n' ? '\n\n' : ''
    const body = selected
      ? selected
          .split('\n')
          .map((line) => (line.trim() ? `## ${line}` : line))
          .join('\n')
      : '## Section title'
    const nextValue = v.slice(0, start) + prefix + body + v.slice(end)
    const titleStart = start + prefix.length + (selected ? 0 : 3)
    replaceSelection(
      nextValue,
      titleStart,
      titleStart + (selected ? body.length : 13),
    )
  }

  function insertList() {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? v.length
    const end = textarea?.selectionEnd ?? v.length
    const selected = v.slice(start, end)
    const prefix = start > 0 && v[start - 1] !== '\n' ? '\n' : ''
    const body = selected
      ? selected
          .split('\n')
          .map((line) =>
            line.trim() ? `- ${line.replace(/^[-*]\s+/, '')}` : line,
          )
          .join('\n')
      : '- First item\n- Second item'
    const nextValue = v.slice(0, start) + prefix + body + v.slice(end)
    const innerStart = start + prefix.length + (selected ? 0 : 2)
    replaceSelection(
      nextValue,
      innerStart,
      innerStart + (selected ? body.length : 10),
    )
  }

  function insertLink() {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? v.length
    const end = textarea?.selectionEnd ?? v.length
    const selected = v.slice(start, end) || 'link text'
    const nextValue =
      v.slice(0, start) +
      `[${selected}](https://example.com)` +
      v.slice(end)
    const urlStart = start + selected.length + 3
    replaceSelection(nextValue, urlStart, urlStart + 19)
  }

  return (
    <div
      className="rounded-md overflow-hidden"
      style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-2 py-2"
        style={{ borderBottom: '1px solid var(--line)' }}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            title="Heading"
            aria-label="Heading"
            onClick={insertHeading}
            disabled={mode !== 'write'}
            className="inline-flex items-center justify-center"
            style={{ ...toolButtonStyle, opacity: mode === 'write' ? 1 : 0.4 }}
          >
            <Heading2 size={14} />
          </button>
          <button
            type="button"
            title="Bold"
            aria-label="Bold"
            onClick={() => wrapSelection('**', '**', 'bold text')}
            disabled={mode !== 'write'}
            className="inline-flex items-center justify-center"
            style={{ ...toolButtonStyle, opacity: mode === 'write' ? 1 : 0.4 }}
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            title="Italic"
            aria-label="Italic"
            onClick={() => wrapSelection('_', '_', 'italic text')}
            disabled={mode !== 'write'}
            className="inline-flex items-center justify-center"
            style={{ ...toolButtonStyle, opacity: mode === 'write' ? 1 : 0.4 }}
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            title="Inline code"
            aria-label="Inline code"
            onClick={() => wrapSelection('`', '`', 'code')}
            disabled={mode !== 'write'}
            className="inline-flex items-center justify-center"
            style={{ ...toolButtonStyle, opacity: mode === 'write' ? 1 : 0.4 }}
          >
            <Code2 size={14} />
          </button>
          <button
            type="button"
            title="List"
            aria-label="List"
            onClick={insertList}
            disabled={mode !== 'write'}
            className="inline-flex items-center justify-center"
            style={{ ...toolButtonStyle, opacity: mode === 'write' ? 1 : 0.4 }}
          >
            <List size={14} />
          </button>
          <button
            type="button"
            title="Link"
            aria-label="Link"
            onClick={insertLink}
            disabled={mode !== 'write'}
            className="inline-flex items-center justify-center"
            style={{ ...toolButtonStyle, opacity: mode === 'write' ? 1 : 0.4 }}
          >
            <Link2 size={14} />
          </button>
        </div>
        <div className="seg" role="tablist" aria-label="Editor mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'write'}
            onClick={() => setMode('write')}
            className={`seg-btn ${mode === 'write' ? 'on' : ''}`}
          >
            <PencilLine size={13} />
            Write
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            onClick={() => setMode('preview')}
            className={`seg-btn ${mode === 'preview' ? 'on' : ''}`}
          >
            <Eye size={13} />
            Preview
          </button>
        </div>
      </div>

      {mode === 'write' ? (
        <textarea
          ref={textareaRef}
          value={v}
          onChange={(e) => onChange(e.target.value)}
          placeholder={cfg.placeholder ?? 'Write with formatting…'}
          rows={6}
          maxLength={cfg.maxLength ?? undefined}
          className="w-full ts-13 mono resize-y"
          style={{
            background: 'var(--bg)',
            border: 'none',
            borderRadius: 0,
            padding: '8px 10px',
            color: 'var(--text)',
            minHeight: 120,
            outline: 'none',
          }}
        />
      ) : (
        <MarkdownPreview
          value={v}
          empty={cfg.placeholder ?? 'Nothing to preview yet.'}
        />
      )}
    </div>
  )
}

export const richTextFieldMaterial: Material = {
  kind: 'rich-text',
  name: 'Rich text',
  icon: '𝐁',
  defaultConfig: {
    placeholder: 'Write with formatting…',
    minLength: 0,
    maxLength: 8000,
    /** Which toolbar groups to expose. */
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
  runtimeRenderer: RichTextRuntime,
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
