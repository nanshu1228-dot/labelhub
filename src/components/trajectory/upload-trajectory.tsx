'use client'
import { useState, useTransition, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { uploadTrajectory } from '@/lib/actions/trajectory-upload'

/**
 * No-key, no-code trajectory upload panel for the Trajectories inbox.
 *
 * Lets a signed-in member paste (or load a file with) a single trajectory
 * JSON object and jump straight into annotating it — so the "annotate your
 * own trajectory" loop can be tried before wiring a proxy or an SDK.
 * Collapsed by default; opens automatically when the inbox is empty.
 */
const SAMPLE = `{
  "schemaVersion": "1.0",
  "source": "upload",
  "agentName": "demo-agent",
  "rootPrompt": "What is 2 + 2?",
  "finalResponse": "2 + 2 = 4.",
  "steps": [
    { "sequence": 0, "kind": "thinking",
      "content": { "text": "Add the two numbers together." } },
    { "sequence": 1, "kind": "tool_call",
      "content": { "toolCallId": "tc_1", "toolName": "calculator",
                   "args": { "expr": "2+2" }, "providerKind": "function" } },
    { "sequence": 2, "kind": "tool_result",
      "content": { "toolCallId": "tc_1", "output": "4" } },
    { "sequence": 3, "kind": "final_response",
      "content": { "text": "2 + 2 = 4." } }
  ]
}`

export function UploadTrajectory({
  workspaceId,
  defaultOpen = false,
}: {
  workspaceId: string
  defaultOpen?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(defaultOpen)
  const [agentName, setAgentName] = useState('uploaded-agent')
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    start(async () => {
      try {
        const res = await uploadTrajectory({
          workspaceId,
          agentName: agentName.trim() || 'uploaded-agent',
          raw,
        })
        // Straight into annotation — the payoff of the loop.
        router.push(
          `/workspaces/${workspaceId}/trajectories/${res.trajectoryId}/annotate`,
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setRaw(await file.text())
      setError(null)
    } catch {
      setError('Could not read that file.')
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ts-12 mono mb-5"
        style={{
          padding: '5px 12px',
          border: '1px solid var(--line)',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--accent)',
          cursor: 'pointer',
        }}
      >
        + Upload a trajectory
      </button>
    )
  }

  return (
    <section
      className="mb-6 rounded-xl p-4"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="lbl">§ UPLOAD A TRAJECTORY</div>
        {!defaultOpen && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ts-12 mono"
            style={{ color: 'var(--mute)', background: 'none', cursor: 'pointer' }}
          >
            close
          </button>
        )}
      </div>
      <p className="ts-13 mb-3" style={{ color: 'var(--mute)' }}>
        Paste a single trajectory as JSON (canonical, Anthropic, or
        OpenAI-assistants format) — no API key needed. It lands in the inbox
        and opens straight in the annotator.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        <label className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
          AGENT NAME
        </label>
        <input
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          maxLength={120}
          className="ts-13 mono"
          style={{
            padding: '5px 10px',
            border: '1px solid var(--line)',
            borderRadius: 6,
            background: 'var(--panel2)',
            color: 'var(--text)',
            outline: 'none',
            minWidth: 200,
          }}
        />
        <label
          className="ts-12 mono"
          style={{
            padding: '5px 10px',
            border: '1px solid var(--line)',
            borderRadius: 6,
            color: 'var(--mute)',
            cursor: 'pointer',
          }}
        >
          choose file…
          <input
            type="file"
            accept=".json,.jsonl,application/json,text/plain"
            onChange={onFile}
            style={{ display: 'none' }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setRaw(SAMPLE)
            setError(null)
          }}
          className="ts-12 mono"
          style={{
            padding: '5px 10px',
            border: '1px solid var(--line)',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--mute)',
            cursor: 'pointer',
          }}
        >
          Load sample
        </button>
      </div>

      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={SAMPLE}
        spellCheck={false}
        rows={10}
        className="ts-12 mono w-full"
        style={{
          padding: '10px',
          border: '1px solid var(--code-line)',
          borderRadius: 8,
          background: 'var(--code-bg)',
          color: 'var(--code-text)',
          outline: 'none',
          lineHeight: 1.5,
          resize: 'vertical',
        }}
      />

      {error && (
        <p className="ts-12 mt-2" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          disabled={pending || raw.trim().length < 2}
          onClick={submit}
          className="ts-13 mono"
          style={{
            padding: '6px 14px',
            border: '1px solid var(--accent-line)',
            borderRadius: 6,
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            cursor: pending ? 'wait' : 'pointer',
            fontWeight: 600,
            opacity: pending || raw.trim().length < 2 ? 0.55 : 1,
          }}
        >
          {pending ? 'uploading…' : 'Upload & annotate'}
        </button>
      </div>
    </section>
  )
}
