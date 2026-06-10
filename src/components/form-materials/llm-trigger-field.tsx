'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import {
  SelectRow,
  TextRow,
} from './primitives'
import type { Material, RuntimeRendererProps } from './types'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * LLM-trigger widget — Spec 4.2 calls it out by name. The Labeler
 * clicks a button on this field; the Renderer (D6/D10) sends the
 * configured prompt + sibling field values to Claude and fills the
 * `targetFieldId` with the response.
 *
 * The configured `targetFieldId` MUST point at another field in the
 * same form (validated at save time by D6 storage layer). This is
 * also the per-field "AI assist" entry point referenced in D10.
 */
type LlmTriggerConfig = {
  buttonLabel?: string
  promptTemplate?: string
  targetFieldId?: string
  tier?: 'fast' | 'default' | 'premium'
}

function LlmTriggerRuntime({
  field,
  readOnly,
  allValues,
  itemData,
  onSetField,
  onChange,
}: RuntimeRendererProps) {
  const cfg = field.config as LlmTriggerConfig
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastAnswer, setLastAnswer] = useState<string | null>(null)

  async function trigger() {
    if (readOnly || pending) return
    setError(null)
    setPending(true)
    try {
      const res = await fetch('/api/llm-assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          promptTemplate:
            cfg.promptTemplate ??
            'Suggest a short answer for the labeled field.',
          context: allValues ?? {},
          tier: cfg.tier ?? 'fast',
          itemData,
        }),
      })
      if (!res.ok) {
        let msg = `LLM assist failed (${res.status})`
        try {
          const body = (await res.json()) as { error?: string }
          if (body.error) msg = body.error
        } catch {
          // body wasn't JSON — keep status message
        }
        setError(msg)
        return
      }
      const body = (await res.json()) as { text?: string }
      const text = body.text?.trim() ?? ''
      setLastAnswer(text)
      // If a targetFieldId is configured AND we have a sibling-write
      // hook, stuff the answer there. Otherwise the answer surfaces
      // inline below the button so the labeler can copy-paste.
      if (cfg.targetFieldId && onSetField) {
        onSetField(cfg.targetFieldId, text)
      } else {
        // No target — record the most recent answer on this field's
        // own value slot so it survives a re-render.
        onChange(text)
      }
    } catch (e) {
      setError(getErrorMessage(e, 'Network error'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="ts-13 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={trigger}
        disabled={pending || readOnly}
        className="ts-13 mono inline-flex items-center gap-2 px-3 py-1.5 rounded self-start"
        style={{
          background: 'oklch(0.55 0.18 320 / 0.1)',
          color: 'oklch(0.55 0.18 320)',
          border: '1px solid oklch(0.55 0.18 320 / 0.4)',
          cursor: pending || readOnly ? 'not-allowed' : 'pointer',
          opacity: pending ? 0.6 : readOnly ? 0.5 : 1,
        }}
      >
        {pending ? (
          <Loader2 size={14} aria-hidden className="animate-spin" />
        ) : (
          <Sparkles size={14} aria-hidden />
        )}
        {pending ? 'Asking…' : cfg.buttonLabel ?? 'Ask Claude'}
      </button>
      {error ? (
        <span className="ts-11" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      ) : (
        <span
          className="ts-11 mono"
          style={{ color: 'var(--mute2)' }}
        >
          fills →{' '}
          <code>{cfg.targetFieldId || '(inline below)'}</code>
        </span>
      )}
      {!cfg.targetFieldId && lastAnswer ? (
        <div
          className="rounded ts-12 p-2"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {lastAnswer}
        </div>
      ) : null}
    </div>
  )
}

export const llmTriggerFieldMaterial: Material = {
  kind: 'llm-trigger',
  name: 'LLM assist',
  icon: '🪄',
  defaultConfig: {
    /** Friendly button label. */
    buttonLabel: 'Ask Claude',
    /** System prompt fragment — appended to the workspace system prompt. */
    promptTemplate:
      'Suggest a short answer for the labeled field based on the form context above. Return ONLY the answer text.',
    /** Which field receives the response. Empty = appears inline only. */
    targetFieldId: '',
    /** Tier passed to chat() — fast (Haiku) is the default for assist. */
    tier: 'fast',
  } satisfies LlmTriggerConfig,
  designerPreview: ({ field }) => {
    const cfg = field.config as LlmTriggerConfig
    return (
      <div className="ts-13" style={{ cursor: 'grab' }}>
        <button
          type="button"
          disabled
          className="ts-13 mono inline-flex items-center gap-2 px-3 py-1.5 rounded"
          style={{
            background: 'oklch(0.55 0.18 320 / 0.1)',
            color: 'oklch(0.55 0.18 320)',
            border: '1px solid oklch(0.55 0.18 320 / 0.4)',
          }}
        >
          <Sparkles size={14} aria-hidden />
          {cfg.buttonLabel ?? 'Ask Claude'}
        </button>
        <div
          className="ts-11 mono mt-1.5"
          style={{ color: 'var(--mute2)' }}
        >
          fills →{' '}
          <code>{cfg.targetFieldId || '(inline only)'}</code>
        </div>
      </div>
    )
  },
  runtimeRenderer: LlmTriggerRuntime,
  propertyPanel: ({ field, onChange }) => {
    const cfg = field.config as LlmTriggerConfig
    function patch(next: Partial<LlmTriggerConfig>) {
      onChange({ ...field, config: { ...cfg, ...next } })
    }
    return (
      <>
        <TextRow
          label="Button label"
          value={cfg.buttonLabel ?? ''}
          onChange={(v) => patch({ buttonLabel: v })}
          placeholder="Ask Claude"
        />
        <TextRow
          label="Prompt template"
          hint="Appended to the workspace system prompt. Form context is added automatically."
          value={cfg.promptTemplate ?? ''}
          onChange={(v) => patch({ promptTemplate: v })}
          multiline
        />
        <TextRow
          label="Target field ID"
          hint="ID of the sibling field this assist fills. Empty = inline-only."
          value={cfg.targetFieldId ?? ''}
          onChange={(v) => patch({ targetFieldId: v })}
          placeholder="f_xxx"
        />
        <SelectRow
          label="Tier"
          hint="fast = Haiku, default = Sonnet, premium = Opus"
          value={cfg.tier ?? 'fast'}
          onChange={(v) => patch({ tier: v })}
          options={[
            { value: 'fast', label: 'fast (Haiku)' },
            { value: 'default', label: 'default (Sonnet)' },
            { value: 'premium', label: 'premium (Opus)' },
          ]}
        />
      </>
    )
  },
}
