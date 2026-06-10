'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  regenerateWorkspaceScope,
  editWorkspaceScopeManually,
} from '@/lib/actions/topic-scope'
import type { ResolvedTopicScope } from '@/lib/queries/topic-scope'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * Topic-scope admin card.
 *
 * Lives on /workspaces/[id]/api so it sits right next to the API keys
 * surface — same mental model ("what does this workspace expose, and how
 * is it locked down").
 *
 * Three states:
 *   1. No scope configured yet → CTA to "Generate from primary task"
 *   2. Scope present (auto-generated) → show suffix + in/out lists + Regenerate
 *   3. Edit mode → admin can replace any of the three fields manually
 */

export function TopicScopeAdmin({
  workspaceId,
  scope,
}: {
  workspaceId: string
  scope: ResolvedTopicScope | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Edit-mode local state — initialized from current scope when entering edit.
  const [inScope, setInScope] = useState(
    scope?.scope.inScope.join('\n') ?? '',
  )
  const [outOfScope, setOutOfScope] = useState(
    scope?.scope.outOfScope.join('\n') ?? '',
  )
  const [suffix, setSuffix] = useState(scope?.scope.suffix ?? '')

  function regen() {
    setError(null)
    setInfo(null)
    startTransition(async () => {
      try {
        await regenerateWorkspaceScope({ workspaceId })
        setInfo('Regenerated from primary task description.')
        router.refresh()
      } catch (e) {
        setError(getErrorMessage(e, 'Regenerate failed.'))
      }
    })
  }

  function startEditing() {
    setInScope(scope?.scope.inScope.join('\n') ?? '')
    setOutOfScope(scope?.scope.outOfScope.join('\n') ?? '')
    setSuffix(scope?.scope.suffix ?? '')
    setEditing(true)
    setError(null)
    setInfo(null)
  }

  function saveEdit() {
    setError(null)
    setInfo(null)
    const newIn = inScope
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const newOut = outOfScope
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (newOut.length === 0) {
      setError('out-of-scope must have at least one entry.')
      return
    }
    if (suffix.trim().length < 40) {
      setError('suffix must be at least 40 chars to be useful.')
      return
    }
    startTransition(async () => {
      try {
        await editWorkspaceScopeManually({
          workspaceId,
          scope: { inScope: newIn, outOfScope: newOut, suffix: suffix.trim() },
        })
        setEditing(false)
        setInfo('Manual edit saved.')
        router.refresh()
      } catch (e) {
        setError(getErrorMessage(e, 'Save failed.'))
      }
    })
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="lbl">TOPIC SCOPE · LAYER A GUARDRAIL</div>
          <h2 className="ts-20" style={{ color: 'var(--hi)', fontWeight: 500 }}>
            What proxied API calls are allowed to discuss
          </h2>
        </div>
        {scope && !editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={startEditing}
              disabled={isPending}
              className="ts-12 mono"
              style={{
                background: 'transparent',
                border: '1px solid var(--line)',
                borderRadius: 5,
                padding: '6px 10px',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              edit manually
            </button>
            <button
              onClick={regen}
              disabled={isPending}
              className="ts-12 mono"
              style={{
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-line)',
                borderRadius: 5,
                padding: '6px 10px',
                color: 'var(--accent)',
                cursor: 'pointer',
              }}
            >
              {isPending ? 'regenerating…' : 'regenerate'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div
          className="rounded-md p-3 mb-3 ts-12"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}
      {info && (
        <div
          className="rounded-md p-3 mb-3 ts-12"
          style={{
            background: 'var(--success-soft)',
            border: '1px solid oklch(0.5 0.13 150 / 0.35)',
            color: 'var(--success)',
          }}
        >
          {info}
        </div>
      )}

      {!scope ? (
        <NoScopeCard onGenerate={regen} pending={isPending} />
      ) : editing ? (
        <EditForm
          inScope={inScope}
          setInScope={setInScope}
          outOfScope={outOfScope}
          setOutOfScope={setOutOfScope}
          suffix={suffix}
          setSuffix={setSuffix}
          onSave={saveEdit}
          onCancel={() => {
            setEditing(false)
            setError(null)
          }}
          pending={isPending}
        />
      ) : (
        <ScopeViewer scope={scope} />
      )}
    </section>
  )
}

function NoScopeCard({
  onGenerate,
  pending,
}: {
  onGenerate: () => void
  pending: boolean
}) {
  return (
    <div
      className="rounded-xl p-6 text-center"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line2)',
      }}
    >
      <div className="lbl mb-2" style={{ color: 'var(--warn)' }}>
        NOT CONFIGURED
      </div>
      <h3 className="ts-16" style={{ color: 'var(--hi)', fontWeight: 500 }}>
        No topic scope on this workspace yet
      </h3>
      <p
        className="ts-13 mt-2 mx-auto"
        style={{ color: 'var(--mute)', maxWidth: 480 }}
      >
        Without a topic scope, a leaked API key can be used to make general-
        purpose chatbot calls through your provider quota. Generate one from
        your primary task description in ~5 seconds.
      </p>
      <button
        onClick={onGenerate}
        disabled={pending}
        className="mt-4 lh-btn lh-btn-sm"
        style={{
          background: 'var(--accent)',
          color: 'white',
          border: '1px solid var(--accent)',
          borderRadius: 6,
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        {pending ? 'generating…' : 'generate scope'}
      </button>
    </div>
  )
}

function ScopeViewer({ scope }: { scope: ResolvedTopicScope }) {
  return (
    <div
      className="rounded-xl"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div
        className="px-4 py-2.5 flex items-center justify-between mono ts-11"
        style={{
          color: 'var(--mute2)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div>
          v{scope.version} · {scope.generatedBy} · generated{' '}
          {scope.generatedAt.toISOString().slice(0, 16).replace('T', ' ')}
        </div>
        {scope.manuallyEditedAt && (
          <span style={{ color: 'var(--warn)' }}>
            edited manually{' '}
            {scope.manuallyEditedAt.toISOString().slice(0, 10)}
          </span>
        )}
      </div>
      <div className="p-4 space-y-4">
        <div>
          <div className="lbl mb-1.5">IN SCOPE · {scope.scope.inScope.length} topics</div>
          <div className="flex flex-wrap gap-1.5">
            {scope.scope.inScope.map((s, i) => (
              <span
                key={i}
                className="ts-12 mono"
                style={{
                  background: 'var(--success-soft)',
                  border: '1px solid oklch(0.5 0.13 150 / 0.35)',
                  color: 'var(--success)',
                  padding: '2px 8px',
                  borderRadius: 4,
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="lbl mb-1.5">
            OUT OF SCOPE · {scope.scope.outOfScope.length} categories
          </div>
          <div className="flex flex-wrap gap-1.5">
            {scope.scope.outOfScope.map((s, i) => (
              <span
                key={i}
                className="ts-12 mono"
                style={{
                  background: 'var(--danger-soft)',
                  border: '1px solid oklch(0.55 0.2 25 / 0.35)',
                  color: 'var(--danger)',
                  padding: '2px 8px',
                  borderRadius: 4,
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="lbl mb-1.5">
            INJECTED SUFFIX · {scope.scope.suffix.length} chars
          </div>
          <pre
            className="ts-12 p-3 rounded-md whitespace-pre-wrap mono"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
              lineHeight: 1.5,
            }}
          >
            {scope.scope.suffix}
          </pre>
        </div>
      </div>
    </div>
  )
}

function EditForm({
  inScope,
  setInScope,
  outOfScope,
  setOutOfScope,
  suffix,
  setSuffix,
  onSave,
  onCancel,
  pending,
}: {
  inScope: string
  setInScope: (v: string) => void
  outOfScope: string
  setOutOfScope: (v: string) => void
  suffix: string
  setSuffix: (v: string) => void
  onSave: () => void
  onCancel: () => void
  pending: boolean
}) {
  return (
    <div
      className="rounded-xl p-4 space-y-4"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
    >
      <Field
        label={`IN SCOPE — one phrase per line (max 15)`}
        value={inScope}
        onChange={setInScope}
        rows={5}
        placeholder={'medical fact-checking\ndrug interactions\n…'}
      />
      <Field
        label={`OUT OF SCOPE — explicit abuse categories (≥1, max 10)`}
        value={outOfScope}
        onChange={setOutOfScope}
        rows={5}
        placeholder={'general coding help\ncreative writing\n…'}
      />
      <Field
        label={`SUFFIX — exact text injected before publisher's own system prompt (40-1200 chars)`}
        value={suffix}
        onChange={setSuffix}
        rows={6}
        placeholder={'You are operating inside the LabelHub annotation harness…'}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={pending}
          className="ts-12 mono"
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '6px 12px',
            cursor: 'pointer',
          }}
        >
          {pending ? 'saving…' : 'save manual edit'}
        </button>
        <button
          onClick={onCancel}
          disabled={pending}
          className="ts-12 mono"
          style={{
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 5,
            padding: '6px 12px',
            color: 'var(--mute)',
            cursor: 'pointer',
          }}
        >
          cancel
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  rows: number
  placeholder?: string
}) {
  return (
    <div>
      <div className="lbl mb-1.5">{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full px-3 py-2 mono ts-12 rounded-md"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          color: 'var(--text)',
          fontFamily: 'var(--font-geist-mono), monospace',
          outline: 'none',
          resize: 'vertical',
        }}
      />
    </div>
  )
}
