'use client'

import { useState, useTransition } from 'react'
import { getFormAnswerCheck } from '@/lib/actions/check-form-answers'
import type {
  FormCheck,
  FormCheckWarning,
  FormFieldSummary,
} from '@/lib/ai/form-answer-checker'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * AI 快检 — pre-submission sanity check for custom-designer forms.
 * Sibling of AIPrecheckButton (pair/arena). SOFT signal, never a blocker:
 * the labeler can always submit. Throttled server-side (20s).
 */
export function CustomFormPrecheckButton({
  topicId,
  buildPayload,
  disabled,
}: {
  topicId: string
  /** Lazily snapshot the current fields + values at click time. */
  buildPayload: () => { fields: FormFieldSummary[]; values: Record<string, unknown> }
  disabled?: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<FormCheck | null>(null)
  const [error, setError] = useState<string | null>(null)

  function runCheck() {
    if (disabled || isPending) return
    setError(null)
    startTransition(async () => {
      try {
        const { fields, values } = buildPayload()
        const r = await getFormAnswerCheck({ topicId, fields, values })
        setResult(r.check)
      } catch (e) {
        setResult(null)
        setError(getErrorMessage(e, 'AI 快检 失败。'))
      }
    })
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={runCheck}
          disabled={disabled || isPending}
          className="ts-13 mono"
          style={{
            background: 'transparent',
            color: 'var(--accent)',
            border: '1px dashed var(--accent-line)',
            borderRadius: 6,
            padding: '6px 14px',
            cursor: disabled || isPending ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.4 : 1,
          }}
          title="提交前让 AI 快速检查一遍(不会拦截提交)"
        >
          {isPending ? '🔮 检查中…' : '🔮 AI 快检'}
        </button>
        {result && !isPending ? (
          <button
            type="button"
            onClick={() => setResult(null)}
            className="ts-11 mono"
            style={{
              background: 'transparent',
              color: 'var(--mute2)',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            dismiss
          </button>
        ) : null}
      </div>

      {error ? (
        <div
          className="ts-12 mono mt-2 p-2 rounded"
          style={{
            background: 'var(--warn-soft)',
            border: '1px solid oklch(0.6 0.14 75 / 0.4)',
            color: 'oklch(0.55 0.14 75)',
          }}
        >
          {error}
        </div>
      ) : null}

      {result ? <PrecheckPanel check={result} /> : null}
    </div>
  )
}

function PrecheckPanel({ check }: { check: FormCheck }) {
  const hasWarnings = check.warnings.length > 0
  return (
    <div
      className="rounded-md mt-2 p-3"
      style={{
        background: hasWarnings ? 'var(--warn-soft)' : 'var(--success-soft)',
        border: `1px solid ${
          hasWarnings ? 'oklch(0.6 0.14 75 / 0.4)' : 'oklch(0.5 0.13 150 / 0.35)'
        }`,
      }}
    >
      <div className="flex items-baseline gap-2 mb-2">
        <span
          className="lbl"
          style={{
            color: hasWarnings ? 'oklch(0.55 0.14 75)' : 'oklch(0.45 0.15 150)',
            letterSpacing: '0.05em',
          }}
        >
          § AI 快检 · {hasWarnings ? `${check.warnings.length} 项建议` : '一切就绪'}
        </span>
      </div>
      <p className="ts-13" style={{ color: 'var(--text)', lineHeight: 1.55 }}>
        {check.summary}
      </p>
      {hasWarnings ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {check.warnings.map((w, i) => (
            <WarningRow key={i} w={w} />
          ))}
        </ul>
      ) : null}
      <div className="ts-11 mono mt-2" style={{ color: 'var(--mute2)' }}>
        AI 建议 — 不是拦截。你仍可直接提交。
      </div>
    </div>
  )
}

function WarningRow({ w }: { w: FormCheckWarning }) {
  const codeColor: Record<FormCheckWarning['code'], string> = {
    empty_required: 'oklch(0.6 0.14 75)',
    thin: 'oklch(0.55 0 0)',
    inconsistent: 'oklch(0.6 0.14 75)',
    format: 'oklch(0.65 0.13 200)',
    risk: 'oklch(0.55 0.2 25)',
  }
  const color = codeColor[w.code]
  return (
    <li className="ts-12 flex items-start gap-2" style={{ color: 'var(--text)' }}>
      <span
        className="mono ts-11 shrink-0"
        style={{
          color,
          background: `${color}1f`,
          border: `1px solid ${color}66`,
          padding: '1px 6px',
          borderRadius: 3,
          letterSpacing: '0.04em',
          minWidth: 84,
          textAlign: 'center',
          fontWeight: 600,
        }}
      >
        {w.code}
      </span>
      <span>{w.message}</span>
      {w.fieldId ? (
        <span
          className="ts-11 mono ml-auto shrink-0"
          style={{ color: 'var(--mute2)' }}
        >
          ↦ {w.fieldId}
        </span>
      ) : null}
    </li>
  )
}
