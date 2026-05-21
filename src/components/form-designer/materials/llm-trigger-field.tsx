'use client'

import {
  SelectRow,
  TextRow,
} from '@/components/form-designer/properties/primitives'
import type { Material } from './types'

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
          🪄 {cfg.buttonLabel ?? 'Ask Claude'}
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
