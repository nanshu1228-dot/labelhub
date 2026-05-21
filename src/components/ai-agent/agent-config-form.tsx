'use client'

/**
 * AI Review Agent config editor — Finals P2 D9.
 *
 * Owner-only surface to tune the per-task Prompt + scoring
 * dimensions + verdict thresholds + on/off toggle. The server
 * action `saveAiAgentConfig` is the persistence boundary.
 *
 * Design:
 *   - Single page; no modal. Owners spend real time tweaking the
 *     prompt; a modal would feel cramped.
 *   - Live token-count badge on the prompt. Soft target 1000 tokens
 *     (Claude doesn't choke past that, but cost scales linearly).
 *     We approximate via len/4 — close enough for the UI signal.
 *   - Dimensions are a CRUD list of {id, name, description}. Drag-
 *     reorder isn't shipped (low value here — order is irrelevant
 *     to the agent's scoring).
 */

import { useEffect, useMemo, useState, useTransition } from 'react'
import type {
  AiAgentConfig,
} from '@/lib/actions/ai-agent-config-schema'

const TIER_OPTIONS = [
  { value: 'fast', label: 'Fast (Haiku)' },
  { value: 'default', label: 'Default (Sonnet)' },
  { value: 'premium', label: 'Premium (Opus)' },
] as const

export interface AgentConfigFormProps {
  taskId: string
  initialConfig: AiAgentConfig
  /**
   * Server action — wired by the page. Returns void on success;
   * throws on validation or auth failure.
   */
  save: (input: { taskId: string; config: AiAgentConfig }) => Promise<void>
}

export function AgentConfigForm({
  taskId,
  initialConfig,
  save,
}: AgentConfigFormProps) {
  const [draft, setDraft] = useState<AiAgentConfig>(initialConfig)
  const [savePending, startSave] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Re-hydrate the local form when the server-derived initial config
  // changes (e.g. page refresh after another tab saved).
  useEffect(() => {
    setDraft(initialConfig)
  }, [initialConfig])

  // Approx token count = chars / 4. Close enough for the UI signal;
  // an exact tokenizer is heavy and unnecessary at this layer.
  const promptTokenEstimate = useMemo(() => {
    return Math.round(draft.promptTemplate.length / 4)
  }, [draft.promptTemplate])

  function patch<K extends keyof AiAgentConfig>(
    key: K,
    value: AiAgentConfig[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }))
    setSaved(false)
  }

  function setDimension(idx: number, next: Partial<AiAgentConfig['dimensions'][number]>) {
    setDraft((d) => ({
      ...d,
      dimensions: d.dimensions.map((dim, i) =>
        i === idx ? { ...dim, ...next } : dim,
      ),
    }))
    setSaved(false)
  }

  function removeDimension(idx: number) {
    setDraft((d) => ({
      ...d,
      dimensions: d.dimensions.filter((_, i) => i !== idx),
    }))
    setSaved(false)
  }

  function addDimension() {
    const idx = draft.dimensions.length + 1
    setDraft((d) => ({
      ...d,
      dimensions: [
        ...d.dimensions,
        { id: `dim_${idx}`, name: `Dimension ${idx}` },
      ],
    }))
    setSaved(false)
  }

  function submit() {
    setError(null)
    if (draft.sendBackAt >= draft.passAt) {
      setError('sendBackAt must be strictly less than passAt.')
      return
    }
    const dimensionIds = draft.dimensions.map((d) => d.id)
    if (new Set(dimensionIds).size !== dimensionIds.length) {
      setError('Dimension ids must be unique.')
      return
    }
    if (dimensionIds.some((id) => !id.trim())) {
      setError('Every dimension needs a non-empty id.')
      return
    }
    startSave(async () => {
      try {
        await save({ taskId, config: draft })
        setSaved(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed.')
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <div>
          <div className="lbl" style={{ color: 'var(--mute)' }}>
            § AI REVIEW AGENT
          </div>
          <h1
            className="ts-22 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            Per-task configuration
          </h1>
          <p className="ts-12 mt-1" style={{ color: 'var(--mute2)' }}>
            Fires on every annotation submit. Returns pass / send_back
            / human_review with per-dimension 0-100 scores.
          </p>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={savePending}
          className="ts-12 mono px-3 py-1.5 rounded"
          style={{
            background: savePending
              ? 'var(--panel2)'
              : 'oklch(0.6 0.18 280)',
            color: savePending ? 'var(--mute2)' : 'white',
            border: '1px solid oklch(0.6 0.18 280 / 0.6)',
            cursor: savePending ? 'not-allowed' : 'pointer',
          }}
        >
          {savePending ? 'Saving…' : 'Save config'}
        </button>
      </header>

      {error ? (
        <div
          className="rounded p-3 ts-12"
          style={{
            background: 'oklch(0.55 0.2 25 / 0.05)',
            border: '1px solid oklch(0.55 0.2 25 / 0.4)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      ) : null}
      {saved ? (
        <div
          className="rounded p-3 ts-12"
          style={{
            background: 'oklch(0.6 0.18 280 / 0.05)',
            border: '1px solid oklch(0.6 0.18 280 / 0.4)',
            color: 'oklch(0.6 0.18 280)',
          }}
        >
          Saved. Next annotation submit will use this config.
        </div>
      ) : null}

      <section
        className="rounded p-4 flex flex-col gap-3"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <label
          className="ts-12 flex items-center justify-between gap-3"
          style={{ cursor: 'pointer' }}
        >
          <span className="flex flex-col gap-0.5">
            <span
              className="lh-mono lh-caption"
              style={{ color: 'var(--mute)' }}
            >
              ENABLED
            </span>
            <span className="ts-11" style={{ color: 'var(--mute2)' }}>
              Off → submits skip the AI Agent entirely.
            </span>
          </span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => patch('enabled', e.target.checked)}
            style={{ accentColor: 'oklch(0.6 0.18 280)' }}
          />
        </label>

        <label className="ts-12 flex flex-col gap-1">
          <span
            className="lh-mono lh-caption flex items-center justify-between"
            style={{ color: 'var(--mute)' }}
          >
            <span>PROMPT TEMPLATE</span>
            <span style={{ color: 'var(--mute2)' }}>
              ~{promptTokenEstimate} tokens
            </span>
          </span>
          <textarea
            value={draft.promptTemplate}
            onChange={(e) => patch('promptTemplate', e.target.value)}
            rows={8}
            className="w-full ts-13 mono resize-y"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 4,
              padding: '8px 10px',
              color: 'var(--text)',
            }}
          />
          <span className="ts-11" style={{ color: 'var(--mute2)' }}>
            The owner&apos;s rubric — applied as the authoritative
            standard. Form context (item + submission) is injected
            automatically.
          </span>
        </label>

        <label className="ts-12 flex flex-col gap-1">
          <span
            className="lh-mono lh-caption"
            style={{ color: 'var(--mute)' }}
          >
            TIER
          </span>
          <select
            value={draft.tier}
            onChange={(e) =>
              patch('tier', e.target.value as AiAgentConfig['tier'])
            }
            className="w-full ts-13"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 4,
              padding: '6px 10px',
              color: 'var(--text)',
            }}
          >
            {TIER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section
        className="rounded p-4 flex flex-col gap-3"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <div
          className="lh-mono lh-caption"
          style={{ color: 'var(--mute)' }}
        >
          THRESHOLDS
        </div>
        <div className="flex gap-4 flex-wrap">
          <label className="ts-12 flex flex-col gap-1">
            <span
              className="lh-mono lh-caption"
              style={{ color: 'var(--mute2)' }}
            >
              PASS AT (≥)
            </span>
            <input
              type="number"
              min={0}
              max={100}
              value={draft.passAt}
              onChange={(e) =>
                patch('passAt', Number(e.target.value))
              }
              className="ts-13 mono"
              style={{
                width: 100,
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '6px 10px',
                color: 'var(--text)',
              }}
            />
          </label>
          <label className="ts-12 flex flex-col gap-1">
            <span
              className="lh-mono lh-caption"
              style={{ color: 'var(--mute2)' }}
            >
              SEND BACK AT (≤)
            </span>
            <input
              type="number"
              min={0}
              max={100}
              value={draft.sendBackAt}
              onChange={(e) =>
                patch('sendBackAt', Number(e.target.value))
              }
              className="ts-13 mono"
              style={{
                width: 100,
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '6px 10px',
                color: 'var(--text)',
              }}
            />
          </label>
        </div>
        <p className="ts-11" style={{ color: 'var(--mute2)' }}>
          score ≥ passAt → pass. score ≤ sendBackAt → send_back.
          Everything between → human_review.
        </p>
      </section>

      <section
        className="rounded p-4 flex flex-col gap-3"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <div className="flex items-center justify-between">
          <div
            className="lh-mono lh-caption"
            style={{ color: 'var(--mute)' }}
          >
            SCORING DIMENSIONS
          </div>
          <button
            type="button"
            onClick={addDimension}
            disabled={draft.dimensions.length >= 10}
            className="ts-11 mono px-2 py-1 rounded"
            style={{
              background: 'var(--panel2)',
              color: 'var(--text)',
              border: '1px solid var(--line)',
              cursor:
                draft.dimensions.length >= 10 ? 'not-allowed' : 'pointer',
            }}
          >
            + Add dimension
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {draft.dimensions.length === 0 ? (
            <li
              className="ts-12"
              style={{ color: 'var(--mute2)' }}
            >
              No dimensions — add at least one (or leave empty for
              one-score-only verdicts).
            </li>
          ) : (
            draft.dimensions.map((dim, idx) => (
              <li
                key={idx}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  defaultValue={dim.id}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v && v !== dim.id) setDimension(idx, { id: v })
                  }}
                  placeholder="id"
                  className="ts-12 mono"
                  style={{
                    width: '25%',
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    padding: '4px 8px',
                    color: 'var(--text)',
                  }}
                />
                <input
                  type="text"
                  defaultValue={dim.name}
                  onBlur={(e) => {
                    const v = e.target.value
                    if (v !== dim.name) setDimension(idx, { name: v })
                  }}
                  placeholder="name"
                  className="ts-12"
                  style={{
                    flex: 1,
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    padding: '4px 8px',
                    color: 'var(--text)',
                  }}
                />
                <input
                  type="text"
                  defaultValue={dim.description ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value
                    if (v !== (dim.description ?? '')) {
                      setDimension(idx, {
                        description: v || undefined,
                      })
                    }
                  }}
                  placeholder="description"
                  className="ts-12"
                  style={{
                    flex: 2,
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    padding: '4px 8px',
                    color: 'var(--text)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => removeDimension(idx)}
                  className="ts-11 mono px-2 py-1 rounded"
                  style={{
                    background: 'transparent',
                    color: 'var(--danger)',
                    border: '1px solid oklch(0.55 0.2 25 / 0.4)',
                    cursor: 'pointer',
                  }}
                  aria-label={`Remove ${dim.name}`}
                >
                  ✕
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  )
}
