'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createJudge } from '@/lib/actions/llm-judges'

/**
 * Admin form for configuring a new LLM judge.
 *
 * Three fields:
 *   name        — display name (e.g. "Sonnet 4.6 — strict factuality")
 *   tier        — model tier passed to lib/ai/client; fast/default/premium
 *   systemPrompt — the judge's grading instructions
 *
 * The platform appends a structured input format on top of whatever
 * system prompt the admin writes (see lib/ai/judge.ts SYSTEM_PROMPT_INTRO),
 * so the admin only needs to express the WORKSPACE-SPECIFIC standards
 * — not the JSON contract. We show a hint about that in the form.
 *
 * After creation, redirect to the judge's detail page so the admin
 * can immediately fire the first run.
 */
export function NewJudgeForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [tier, setTier] = useState<'fast' | 'default' | 'premium'>('default')
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required.')
      return
    }
    if (systemPrompt.trim().length < 8) {
      setError('System prompt must be at least 8 characters.')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const r = await createJudge({
          workspaceId,
          name: trimmedName,
          tier,
          systemPrompt,
        })
        router.push(`/workspaces/${workspaceId}/judges/${r.judgeId}`)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Create judge failed.')
      }
    })
  }

  return (
    <div>
      <div className="lbl mb-1">§ NEW LLM JUDGE</div>
      <h1 className="ts-24 mb-2" style={{ color: 'var(--hi)' }}>
        Configure a judge
      </h1>
      <p
        className="ts-13 mb-6"
        style={{ color: 'var(--mute)', maxWidth: 640 }}
      >
        The judge will be asked to produce the same structured payload
        your human raters submit — yes/no per rubric for pair-rubric,
        or 1–5 per dimension + verdict for arena-gsb. The platform
        wraps your system prompt with a strict I/O contract, so focus
        your prompt on what counts as <em>good</em> in your domain.
      </p>

      <section className="mb-4">
        <label
          className="ts-12 mono block mb-1.5"
          style={{ color: 'var(--mute)' }}
        >
          NAME *
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="e.g. Sonnet 4.6 · strict factuality"
          className="w-full px-3 py-2 ts-13 rounded-md"
          style={inputStyle}
        />
      </section>

      <section className="mb-4">
        <label
          className="ts-12 mono block mb-1.5"
          style={{ color: 'var(--mute)' }}
        >
          MODEL TIER *
        </label>
        <div className="flex gap-2">
          {(['fast', 'default', 'premium'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              className="ts-13 mono"
              style={{
                background:
                  tier === t ? 'var(--accent)' : 'transparent',
                color: tier === t ? 'white' : 'var(--text)',
                border: `1px solid ${
                  tier === t ? 'var(--accent)' : 'var(--line)'
                }`,
                borderRadius: 6,
                padding: '6px 14px',
                fontWeight: 500,
                cursor: 'pointer',
                flex: 1,
              }}
            >
              {t}{' '}
              <span
                className="ts-11 ml-1"
                style={{ opacity: 0.7 }}
              >
                {t === 'fast'
                  ? 'Haiku-class'
                  : t === 'default'
                    ? 'Sonnet-class'
                    : 'Opus-class'}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="mb-4">
        <label
          className="ts-12 mono block mb-1.5"
          style={{ color: 'var(--mute)' }}
        >
          SYSTEM PROMPT *
        </label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={12}
          maxLength={20_000}
          className="w-full px-3 py-2 ts-13 mono rounded-md"
          style={{ ...inputStyle, fontFamily: 'var(--font-geist-mono)' }}
        />
        <div
          className="ts-11 mono mt-1"
          style={{ color: 'var(--mute2)' }}
        >
          The I/O contract is appended automatically. Focus your prompt
          on rubric interpretation, edge cases, and workspace-specific
          rules.
        </div>
      </section>

      {error && (
        <div
          className="ts-12 mono mb-3 p-2 rounded"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="ts-13 mono"
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '8px 16px',
            fontWeight: 500,
            cursor: pending ? 'not-allowed' : 'pointer',
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? 'creating…' : 'create judge'}
        </button>
      </div>
    </div>
  )
}

const DEFAULT_PROMPT = `You are evaluating LLM outputs for an annotation workspace.

For each rubric item / dimension you are given, judge BOTH model A and
model B's response against the rubric description. Be calibrated — don't
inflate scores or treat "good enough" as "great". When a response has a
factual error, score factuality / correctness items accordingly even if
the overall answer is helpful.

Apply this workspace's standards:
  - Prefer answers that directly address the user's intent.
  - Penalize hallucinated facts, ungrounded claims, and policy violations.
  - For 1-5 dimensions: 1 = poor, 3 = adequate, 5 = excellent. Reserve 5
    for genuinely outstanding responses.
  - Match the language of the prompt in your reasoning text.`

const inputStyle: React.CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  color: 'var(--text)',
  outline: 'none',
}
