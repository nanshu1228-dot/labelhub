'use client'
import { useState, useTransition } from 'react'
import { addConnectionDemo } from '@/lib/actions/connections'

interface ProviderOpt {
  kind: string
  label: string
  defaultBaseUrl: string
}

export function ConnectionFormClient({
  workspaceId,
  providers,
}: {
  workspaceId: string
  providers: ProviderOpt[]
}) {
  const [providerKind, setProviderKind] = useState(providers[0]?.kind ?? '')
  const [displayName, setDisplayName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [rateLimitRpm, setRateLimitRpm] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selected = providers.find((p) => p.kind === providerKind)

  const submit = () => {
    setError(null)
    setSuccess(null)
    if (!displayName.trim()) {
      setError('Display name required')
      return
    }
    if (apiKey.length < 8) {
      setError('API key looks too short')
      return
    }
    startTransition(async () => {
      try {
        await addConnectionDemo({
          workspaceId,
          providerKind,
          displayName: displayName.trim(),
          apiKey,
          baseUrl: baseUrl.trim() || null,
          rateLimitRpm: rateLimitRpm ? Number(rateLimitRpm) : null,
        })
        setSuccess(`Connection added · "${displayName}" routes via Vault.`)
        setDisplayName('')
        setApiKey('')
        setBaseUrl('')
        setRateLimitRpm('')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to add connection.')
      }
    })
  }

  return (
    <div
      className="rounded-xl px-4 py-4"
      style={{
        border: '1px solid var(--line)',
        background: 'var(--panel)',
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Provider">
          <select
            value={providerKind}
            onChange={(e) => setProviderKind(e.target.value)}
            className="inp"
          >
            {providers.map((p) => (
              <option key={p.kind} value={p.kind}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Display name">
          <input
            type="text"
            placeholder="e.g. Doubao production"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="inp"
            maxLength={80}
          />
        </Field>
        <Field label="API key" wide>
          <input
            type="password"
            placeholder="sk-... / ark-... / sk-ant-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="inp"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Base URL (override)">
          <input
            type="text"
            placeholder={selected?.defaultBaseUrl ?? ''}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="inp"
          />
        </Field>
        <Field label="Rate limit (req/min)">
          <input
            type="number"
            min={1}
            max={100000}
            placeholder="optional"
            value={rateLimitRpm}
            onChange={(e) => setRateLimitRpm(e.target.value)}
            className="inp"
          />
        </Field>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="lh-btn lh-btn-accent"
        >
          {pending ? 'Saving…' : 'Add connection'}
        </button>
        {error && (
          <span className="ts-13 mono" style={{ color: 'var(--danger)' }}>
            {error}
          </span>
        )}
        {success && (
          <span className="ts-13 mono" style={{ color: 'var(--success)' }}>
            {success}
          </span>
        )}
      </div>

      <p className="ts-12 mono mt-3" style={{ color: 'var(--mute2)' }}>
        Key is sent over HTTPS, encrypted by Supabase Vault (pgsodium) at
        rest, and never returned to the client.
      </p>
    </div>
  )
}

function Field({
  label,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <label
      className={`flex flex-col gap-1 ${wide ? 'md:col-span-2' : ''}`}
    >
      <span className="lbl">{label}</span>
      {children}
    </label>
  )
}
