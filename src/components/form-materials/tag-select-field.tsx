'use client'

import { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import {
  NumberRow,
  OptionListEditor,
  ToggleRow,
  type OptionItem,
} from './primitives'
import type { Material, RuntimeRendererProps } from './types'

type TagSelectConfig = {
  options?: OptionItem[]
  allowCustom?: boolean
  minTags?: number | null
  maxTags?: number | null
}

function TagSelectRuntime({
  field,
  value,
  onChange,
  readOnly,
}: RuntimeRendererProps) {
  const cfg = field.config as TagSelectConfig
  const options = cfg.options ?? []
  const allowCustom = cfg.allowCustom !== false
  const selected = normalizeTags(value)
  const [draft, setDraft] = useState('')
  const max = cfg.maxTags ?? Number.POSITIVE_INFINITY

  function commitTag(raw: string) {
    if (readOnly) return
    const tag = raw.trim()
    if (!tag || selected.includes(tag) || selected.length >= max) return
    onChange([...selected, tag])
    setDraft('')
  }

  function toggleTag(tag: string) {
    if (readOnly) return
    if (selected.includes(tag)) {
      onChange(selected.filter((item) => item !== tag))
      return
    }
    if (selected.length >= max) return
    onChange([...selected, tag])
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {selected.length === 0 ? (
          <span className="ts-12" style={{ color: 'var(--mute2)' }}>
            No tags selected
          </span>
        ) : (
          selected.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              disabled={readOnly}
              className="ts-12 mono inline-flex items-center gap-1 rounded-full px-2 py-1"
              style={{
                background: 'oklch(0.58 0.14 185 / 0.11)',
                border: '1px solid oklch(0.58 0.14 185 / 0.34)',
                color: 'oklch(0.45 0.13 185)',
                cursor: readOnly ? 'default' : 'pointer',
              }}
              aria-label={`Remove tag ${tag}`}
              title={readOnly ? tag : `Remove ${tag}`}
            >
              #{labelForTag(options, tag)}
              {!readOnly ? <X size={12} aria-hidden /> : null}
            </button>
          ))
        )}
      </div>

      {options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => {
            const on = selected.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleTag(opt.value)}
                disabled={readOnly || (!on && selected.length >= max)}
                className="ts-12 mono inline-flex items-center gap-1 rounded-full px-2 py-1"
                style={{
                  background: on ? 'var(--accent-soft)' : 'var(--panel2)',
                  border: `1px solid ${on ? 'var(--accent-line)' : 'var(--line)'}`,
                  color: 'var(--text)',
                  cursor: readOnly ? 'default' : 'pointer',
                  opacity: !on && selected.length >= max ? 0.55 : 1,
                }}
              >
                {on ? (
                  <Check size={12} aria-hidden />
                ) : (
                  <Plus size={12} aria-hidden />
                )}
                {opt.label}
              </button>
            )
          })}
        </div>
      ) : null}

      {allowCustom && !readOnly ? (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ',') return
            e.preventDefault()
            commitTag(draft)
          }}
          onBlur={() => commitTag(draft)}
          placeholder={
            selected.length >= max ? 'Tag limit reached' : 'Type tag, press Enter'
          }
          className="ts-13"
          disabled={selected.length >= max}
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            color: 'var(--text)',
            padding: '7px 10px',
            maxWidth: 320,
          }}
        />
      ) : null}
    </div>
  )
}

export const tagSelectFieldMaterial: Material = {
  kind: 'tag-select',
  name: 'Tag select',
  icon: '#',
  defaultConfig: {
    options: [
      { value: 'quality', label: 'Quality' },
      { value: 'safety', label: 'Safety' },
      { value: 'format', label: 'Format' },
    ],
    allowCustom: true,
    minTags: 0,
    maxTags: null,
  } satisfies TagSelectConfig,
  designerPreview: ({ field }) => {
    const cfg = field.config as TagSelectConfig
    const options = cfg.options ?? []
    return (
      <div className="flex flex-wrap gap-1.5" style={{ cursor: 'grab' }}>
        {options.length === 0 ? (
          <span className="ts-12" style={{ color: 'var(--mute2)' }}>
            Free-form tags
          </span>
        ) : (
          options.slice(0, 5).map((opt) => (
            <span
              key={opt.value}
              className="ts-12 mono inline-flex items-center rounded-full px-2 py-1"
              style={{
                background: 'oklch(0.58 0.14 185 / 0.09)',
                border: '1px solid oklch(0.58 0.14 185 / 0.28)',
                color: 'oklch(0.45 0.13 185)',
              }}
            >
              #{opt.label}
            </span>
          ))
        )}
      </div>
    )
  },
  runtimeRenderer: TagSelectRuntime,
  propertyPanel: ({ field, onChange }) => {
    const cfg = field.config as TagSelectConfig
    function patch(next: Partial<TagSelectConfig>) {
      onChange({ ...field, config: { ...cfg, ...next } })
    }
    return (
      <>
        <OptionListEditor
          options={cfg.options ?? []}
          onChange={(options) => patch({ options })}
        />
        <ToggleRow
          label="Allow custom tags"
          value={cfg.allowCustom !== false}
          onChange={(allowCustom) => patch({ allowCustom })}
        />
        <NumberRow
          label="Min tags"
          value={cfg.minTags ?? null}
          onChange={(v) => patch({ minTags: v })}
          min={0}
          placeholder="0"
        />
        <NumberRow
          label="Max tags"
          value={cfg.maxTags ?? null}
          onChange={(v) => patch({ maxTags: v })}
          min={1}
          placeholder="No limit"
        />
      </>
    )
  },
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function labelForTag(options: OptionItem[], tag: string): string {
  return options.find((opt) => opt.value === tag)?.label ?? tag
}
