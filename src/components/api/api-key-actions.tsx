'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createApiKey, revokeApiKey } from '@/lib/actions/api-keys'

/**
 * In-UI API key lifecycle controls for the /workspaces/[id]/api page.
 *
 * These wire the already-built, admin-gated `createApiKey` / `revokeApiKey`
 * server actions to the browser so a self-serve user no longer needs the
 * `npm run bootstrap` CLI to get a working key. The plain key is shown
 * exactly once (the action returns it once; the DB stores only a hash), so
 * the create modal renders a copy-once panel plus a ready-to-run snippet
 * pointed at the real deployed origin.
 */

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard blocked — user can select manually */
        }
      }}
      className="ts-12 mono"
      style={{
        padding: '3px 10px',
        border: '1px solid var(--line)',
        borderRadius: 6,
        background: copied ? 'var(--success-soft)' : 'transparent',
        color: copied ? 'var(--success)' : 'var(--mute)',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {copied ? 'copied ✓' : label}
    </button>
  )
}

export function CreateApiKeyButton({
  workspaceId,
  origin,
}: {
  workspaceId: string
  origin: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{
    plainKey: string
    name: string
  } | null>(null)
  const [pending, start] = useTransition()

  function reset() {
    setOpen(false)
    setName('')
    setError(null)
    setCreated(null)
  }

  function submit() {
    setError(null)
    start(async () => {
      try {
        const res = await createApiKey({
          workspaceId,
          name: name.trim() || 'default',
        })
        setCreated({ plainKey: res.plainKey, name: res.name })
        // Refresh so the new (masked) row appears in the table behind the panel.
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ts-12 mono"
        style={{
          padding: '5px 12px',
          border: '1px solid var(--accent-line)',
          borderRadius: 6,
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        + New key
      </button>
    )
  }

  const setupSnippet = created
    ? `# Claude Code / Anthropic SDK — every call is captured:
export ANTHROPIC_BASE_URL=${origin}/api/proxy/anthropic
export ANTHROPIC_API_KEY=${created.plainKey}

# OpenAI-compatible clients: base_url = ${origin}/api/proxy/<provider>
# and use this key as the Bearer token / api_key.`
    : ''

  return (
    <div
      className="rounded-xl p-4"
      style={{
        border: '1px solid var(--line)',
        background: 'var(--panel)',
        minWidth: 360,
        maxWidth: 560,
      }}
    >
      {!created ? (
        <>
          <div className="ts-13 mb-2" style={{ color: 'var(--hi)' }}>
            Create API key
          </div>
          <label
            className="ts-12 mono block mb-1"
            style={{ color: 'var(--mute2)' }}
          >
            NAME
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !pending) submit()
            }}
            placeholder="e.g. my-laptop, ci, prod-agent"
            maxLength={60}
            className="ts-13 mono w-full"
            style={{
              padding: '7px 10px',
              border: '1px solid var(--line)',
              borderRadius: 6,
              background: 'var(--panel2)',
              color: 'var(--text)',
              outline: 'none',
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
              disabled={pending}
              onClick={submit}
              className="ts-12 mono"
              style={{
                padding: '5px 12px',
                border: '1px solid var(--accent-line)',
                borderRadius: 6,
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                cursor: pending ? 'wait' : 'pointer',
                fontWeight: 600,
                opacity: pending ? 0.6 : 1,
              }}
            >
              {pending ? 'creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={reset}
              className="ts-12 mono"
              style={{
                padding: '5px 12px',
                border: '1px solid var(--line)',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--mute)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="ts-13 mb-1" style={{ color: 'var(--hi)' }}>
            Key “{created.name}” created
          </div>
          <p className="ts-12 mb-3" style={{ color: 'var(--warn)' }}>
            Copy it now — it is shown once and cannot be retrieved again.
          </p>
          <div
            className="flex items-center gap-2 mb-3 p-2 rounded-md"
            style={{
              border: '1px solid var(--line)',
              background: 'var(--panel2)',
            }}
          >
            <code
              className="ts-12 mono flex-1 break-all"
              style={{ color: 'var(--accent)' }}
            >
              {created.plainKey}
            </code>
            <CopyButton text={created.plainKey} label="Copy key" />
          </div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span
              className="ts-12 mono"
              style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
            >
              QUICK START
            </span>
            <CopyButton text={setupSnippet} label="Copy setup" />
          </div>
          <pre
            className="ts-12 mono p-3 rounded-md overflow-x-auto"
            style={{
              background: 'var(--code-bg)',
              border: '1px solid var(--code-line)',
              color: 'var(--code-text)',
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            {setupSnippet}
          </pre>
          <div className="mt-3">
            <button
              type="button"
              onClick={reset}
              className="ts-12 mono"
              style={{
                padding: '5px 12px',
                border: '1px solid var(--line)',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--mute)',
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function RevokeKeyButton({ apiKeyId }: { apiKeyId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          !window.confirm(
            'Revoke this key? Clients still using it will start getting 401s. This cannot be undone.',
          )
        ) {
          return
        }
        start(async () => {
          try {
            await revokeApiKey({ apiKeyId })
          } finally {
            router.refresh()
          }
        })
      }}
      className="ts-12 mono"
      style={{
        padding: '2px 8px',
        border: '1px solid var(--line)',
        borderRadius: 5,
        background: 'transparent',
        color: pending ? 'var(--mute2)' : 'var(--danger)',
        cursor: pending ? 'wait' : 'pointer',
      }}
    >
      {pending ? '…' : 'revoke'}
    </button>
  )
}
