'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { renameWorkspace } from '@/lib/actions/workspaces'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * Settings page client component.
 *
 * Renders three sections:
 *   1. Identity — name (editable by admin) + id (read-only, copy button)
 *   2. Template — mode label + description (read-only for everyone)
 *   3. Metadata — created date
 *
 * Admin gating is enforced server-side in the action; the client just hides
 * input affordances for non-admins to keep the UX clear.
 */
export function SettingsClient({
  workspaceId,
  initialName,
  templateMode,
  templateLabel,
  templateDescription,
  createdAt,
  isAdmin,
}: {
  workspaceId: string
  initialName: string
  templateMode: string
  templateLabel: string
  templateDescription: string
  createdAt: Date
  isAdmin: boolean
}) {
  return (
    <div className="space-y-8">
      <IdentitySection
        workspaceId={workspaceId}
        initialName={initialName}
        isAdmin={isAdmin}
      />

      <TemplateSection
        mode={templateMode}
        label={templateLabel}
        description={templateDescription}
      />

      <MetadataSection workspaceId={workspaceId} createdAt={createdAt} />
    </div>
  )
}

function IdentitySection({
  workspaceId,
  initialName,
  isAdmin,
}: {
  workspaceId: string
  initialName: string
  isAdmin: boolean
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function save() {
    setError(null)
    setInfo(null)
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setError('Name cannot be blank.')
      return
    }
    startTransition(async () => {
      try {
        await renameWorkspace({ workspaceId, name: trimmed })
        setInfo('Saved.')
        router.refresh()
      } catch (e) {
        setError(getErrorMessage(e, 'Save failed.'))
      }
    })
  }

  const changed = name.trim() !== initialName

  return (
    <section>
      <div className="lbl mb-3">IDENTITY</div>
      <div
        className="rounded-xl p-5 space-y-4"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <Field
          label="Name"
          hint="Shown in the dashboard, the API responses, and to teammates."
        >
          {isAdmin ? (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="w-full px-3 py-2 ts-13 rounded-md"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
                outline: 'none',
              }}
            />
          ) : (
            <div
              className="ts-13 px-3 py-2 rounded-md"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
              }}
            >
              {initialName}
            </div>
          )}
        </Field>

        {error && (
          <div
            className="ts-12 rounded-md p-2"
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
            className="ts-12 rounded-md p-2"
            style={{
              background: 'var(--success-soft)',
              border: '1px solid oklch(0.5 0.13 150 / 0.35)',
              color: 'var(--success)',
            }}
          >
            {info}
          </div>
        )}

        {isAdmin && (
          <div className="flex items-center justify-end">
            <button
              onClick={save}
              disabled={isPending || !changed}
              className="ts-13 mono"
              style={{
                background: changed ? 'var(--accent)' : 'var(--panel2)',
                color: changed ? 'white' : 'var(--mute2)',
                border: `1px solid ${changed ? 'var(--accent)' : 'var(--line)'}`,
                borderRadius: 6,
                padding: '8px 16px',
                fontWeight: 500,
                cursor: isPending || !changed ? 'not-allowed' : 'pointer',
              }}
            >
              {isPending ? 'saving…' : 'save'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function TemplateSection({
  mode,
  label,
  description,
}: {
  mode: string
  label: string
  description: string
}) {
  return (
    <section>
      <div className="lbl mb-3">TEMPLATE</div>
      <div
        className="rounded-xl p-5 space-y-4"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <Field
          label="Mode"
          hint="Immutable after creation — switching mid-stream would invalidate every annotation's rubric set."
        >
          <div className="flex items-center gap-2">
            <span
              className="mono ts-12"
              style={{
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                border: '1px solid var(--accent-line)',
                padding: '3px 10px',
                borderRadius: 4,
              }}
            >
              {mode}
            </span>
            <span className="ts-13" style={{ color: 'var(--hi)' }}>
              {label}
            </span>
          </div>
        </Field>
        {description && (
          <p className="ts-12" style={{ color: 'var(--mute)' }}>
            {description}
          </p>
        )}
      </div>
    </section>
  )
}

function MetadataSection({
  workspaceId,
  createdAt,
}: {
  workspaceId: string
  createdAt: Date
}) {
  const [copied, setCopied] = useState(false)

  async function copyId() {
    try {
      await navigator.clipboard.writeText(workspaceId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore — older browsers */
    }
  }

  return (
    <section>
      <div className="lbl mb-3">METADATA</div>
      <div
        className="rounded-xl p-5 space-y-4"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <Field
          label="Workspace id"
          hint="Use this when filing support issues or wiring SDK clients."
        >
          <div className="flex items-center gap-2">
            <code
              className="mono ts-12 px-2 py-1 rounded-md flex-1 trunc-1"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
              }}
            >
              {workspaceId}
            </code>
            <button
              onClick={copyId}
              className="mono ts-12"
              style={{
                background: 'var(--panel2)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '4px 10px',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              {copied ? '✓ copied' : 'copy'}
            </button>
          </div>
        </Field>

        <Field label="Created">
          <div
            className="mono ts-12 px-3 py-2 rounded-md"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
            }}
          >
            {new Date(createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
          </div>
        </Field>
      </div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="lbl mb-1.5">{label}</div>
      {children}
      {hint && (
        <div className="ts-11 mt-1.5" style={{ color: 'var(--mute2)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}
