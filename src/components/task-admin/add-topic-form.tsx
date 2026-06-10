'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createTopic } from '@/lib/actions/topics'
import type { TemplateMode } from '@/lib/templates/types'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * Admin "add topic" form for pair-rubric / arena-gsb tasks.
 *
 * Both modes use the same itemSchema envelope: prompt + responseA + responseB
 * (+ optional context). The same form fits both. On submit we call the
 * `createTopic` action which validates against the template's itemSchema
 * server-side.
 *
 * Trajectory tasks don't use this form — topics auto-materialize from
 * captured trajectories via the inbox machinery.
 */
export function AddTopicForm({
  taskId,
  templateMode,
}: {
  workspaceId: string
  taskId: string
  templateMode: TemplateMode
}) {
  const router = useRouter()
  const [prompt, setPrompt] = useState('')
  const [aName, setAName] = useState('')
  const [aContent, setAContent] = useState('')
  const [bName, setBName] = useState('')
  const [bContent, setBContent] = useState('')
  const [context, setContext] = useState('')
  const [autoDifficulty, setAutoDifficulty] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setPrompt('')
    setAName('')
    setAContent('')
    setBName('')
    setBContent('')
    setContext('')
  }

  function submit() {
    const p = prompt.trim()
    if (!p) {
      setError('Prompt is required.')
      return
    }
    if (!aName.trim() || !aContent.trim()) {
      setError('Model A needs a name and a response.')
      return
    }
    if (!bName.trim() || !bContent.trim()) {
      setError('Model B needs a name and a response.')
      return
    }
    setError(null)
    setOkMsg(null)
    startTransition(async () => {
      try {
        const topic = await createTopic({
          taskId,
          itemData: {
            prompt: p,
            responseA: {
              modelName: aName.trim(),
              content: aContent.trim(),
            },
            responseB: {
              modelName: bName.trim(),
              content: bContent.trim(),
            },
            context: context.trim() || undefined,
          },
          autoEstimateDifficulty: autoDifficulty,
        })
        // Surface what the AI estimated so the admin knows it ran (and
        // can spot a misjudgment immediately). NULL difficulty means
        // we either disabled it or the call failed silently.
        const note =
          autoDifficulty && topic.difficulty != null
            ? ` · 🔥 difficulty ${topic.difficulty}/5 — ${topic.difficultyReason ?? ''}`
            : ''
        setOkMsg(`Topic added — added to the list below.${note}`)
        reset()
        router.refresh()
      } catch (e) {
        setError(getErrorMessage(e, 'Create topic failed.'))
      }
    })
  }

  // Both templateModes use the same envelope — modeLabel is just a small
  // visual cue so the admin sees they're adding the right kind of row.
  const modeLabel =
    templateMode === 'pair-rubric'
      ? 'yes/no rubric task'
      : 'GSB scoring task'

  return (
    <div
      className="rounded-md p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <p
        className="ts-12 mono mb-3"
        style={{ color: 'var(--mute2)' }}
      >
        {modeLabel} · prompt + 2 model responses per topic
      </p>

      <Field label="Prompt *">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          maxLength={8000}
          placeholder="The user-facing question or instruction."
          className="w-full px-3 py-2 ts-13 rounded-md"
          style={inputStyle}
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ResponseSide
          side="A"
          name={aName}
          content={aContent}
          onName={setAName}
          onContent={setAContent}
        />
        <ResponseSide
          side="B"
          name={bName}
          content={bContent}
          onName={setBName}
          onContent={setBContent}
        />
      </div>

      <Field label="Context (optional, e.g. gold answer or retrieval)">
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={2}
          maxLength={8000}
          placeholder="Anything the annotator should see alongside the prompt — not the prompt itself."
          className="w-full px-3 py-2 ts-13 rounded-md mono"
          style={inputStyle}
        />
      </Field>

      {error && (
        <div
          className="ts-12 mono mt-2 p-2 rounded"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}
      {okMsg && (
        <div
          className="ts-12 mono mt-2 p-2 rounded"
          style={{
            background: 'oklch(0.65 0.18 200 / 0.1)',
            border: '1px solid oklch(0.65 0.18 200 / 0.35)',
            color: 'oklch(0.65 0.18 200)',
          }}
        >
          {okMsg}
        </div>
      )}

      <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
        <label
          className="ts-12 mono inline-flex items-center gap-2"
          style={{ color: 'var(--mute)', cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={autoDifficulty}
            onChange={(e) => setAutoDifficulty(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          <span>🪄 auto-estimate difficulty (adjusts payout)</span>
        </label>
        <button
          onClick={submit}
          disabled={pending}
          className="ts-13 mono"
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '6px 14px',
            fontWeight: 500,
            cursor: pending ? 'not-allowed' : 'pointer',
            opacity: pending ? 0.5 : 1,
          }}
        >
          {pending
            ? autoDifficulty
              ? 'adding + estimating…'
              : 'adding…'
            : 'add topic'}
        </button>
      </div>
    </div>
  )
}

function ResponseSide({
  side,
  name,
  content,
  onName,
  onContent,
}: {
  side: 'A' | 'B'
  name: string
  content: string
  onName: (v: string) => void
  onContent: (v: string) => void
}) {
  const accent = side === 'A' ? 'oklch(0.65 0.18 200)' : 'oklch(0.7 0.18 30)'
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: 'var(--panel2)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="mono ts-11"
          style={{
            color: accent,
            border: `1px solid ${accent}66`,
            background: `${accent}1a`,
            borderRadius: 3,
            padding: '1px 6px',
            fontWeight: 600,
          }}
        >
          {side}
        </span>
        <span className="ts-12 mono" style={{ color: 'var(--mute)' }}>
          response
        </span>
      </div>
      <Field label="model name *">
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          maxLength={100}
          placeholder={side === 'A' ? 'gpt-4o' : 'claude-sonnet-4.6'}
          className="w-full px-3 py-2 ts-13 mono rounded-md"
          style={inputStyle}
        />
      </Field>
      <Field label="response text *">
        <textarea
          value={content}
          onChange={(e) => onContent(e.target.value)}
          rows={6}
          maxLength={16000}
          placeholder="The model's full output for this prompt."
          className="w-full px-3 py-2 ts-13 rounded-md"
          style={inputStyle}
        />
      </Field>
    </div>
  )
}

const inputStyle = {
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  color: 'var(--text)',
  outline: 'none',
  fontFamily: 'var(--font-geist-sans), system-ui',
} as const

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block mb-3 last:mb-0">
      <span
        className="ts-11 mono mb-1 block"
        style={{ color: 'var(--mute2)' }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}
