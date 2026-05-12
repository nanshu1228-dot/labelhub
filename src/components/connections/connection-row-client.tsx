'use client'
import { useTransition } from 'react'
import {
  disableConnectionDemo,
  enableConnectionDemo,
  deleteConnectionDemo,
} from '@/lib/actions/connections'

export interface ConnectionRowData {
  id: string
  providerKind: string
  displayName: string
  baseUrl: string | null
  keyDisplay: string | null
  rateLimitRpm: number | null
  enabled: boolean
  createdAt: string
  lastUsedAt: string | null
}

export function ConnectionRowClient({
  workspaceId,
  connection,
}: {
  workspaceId: string
  connection: ConnectionRowData
}) {
  const [pending, startTransition] = useTransition()

  const onToggle = () => {
    startTransition(async () => {
      if (connection.enabled) {
        await disableConnectionDemo({
          workspaceId,
          connectionId: connection.id,
        })
      } else {
        await enableConnectionDemo({
          workspaceId,
          connectionId: connection.id,
        })
      }
    })
  }

  const onDelete = () => {
    if (
      !confirm(
        `Delete connection "${connection.displayName}"? This also removes its vault secret.`,
      )
    )
      return
    startTransition(async () => {
      await deleteConnectionDemo({
        workspaceId,
        connectionId: connection.id,
      })
    })
  }

  return (
    <div
      className="rounded-xl px-4 py-3 flex flex-wrap items-center gap-3"
      style={{
        border: '1px solid var(--line)',
        background: connection.enabled ? 'var(--panel)' : 'var(--panel2)',
        opacity: connection.enabled ? 1 : 0.65,
      }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span
          className="badge violet"
          title={`provider_kind: ${connection.providerKind}`}
        >
          {connection.providerKind}
        </span>
        <span
          className="ts-13 mono truncate-1"
          style={{ color: 'var(--hi)', fontWeight: 500 }}
        >
          {connection.displayName}
        </span>
        <span
          className="ts-12 mono"
          style={{ color: 'var(--mute)' }}
        >
          {connection.keyDisplay ?? '(no key suffix)'}
        </span>
      </div>

      <div
        className="ts-12 mono flex items-center gap-3"
        style={{ color: 'var(--mute2)' }}
      >
        {connection.rateLimitRpm && (
          <span title="Requests per minute cap">
            {connection.rateLimitRpm}/min
          </span>
        )}
        {connection.baseUrl && (
          <span
            className="truncate-1"
            style={{ maxWidth: 200 }}
            title={connection.baseUrl}
          >
            {connection.baseUrl.replace(/^https?:\/\//, '')}
          </span>
        )}
        {connection.lastUsedAt ? (
          <span title={`last used: ${connection.lastUsedAt}`}>
            used {timeAgo(connection.lastUsedAt)}
          </span>
        ) : (
          <span style={{ color: 'var(--mute)' }}>never used</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={pending}
          className="lh-btn lh-btn-sm lh-btn-ghost"
        >
          {connection.enabled ? 'disable' : 'enable'}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="lh-btn lh-btn-sm lh-btn-ghost"
          style={{ color: 'var(--danger)' }}
        >
          delete
        </button>
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  const ageS = Math.max(0, (Date.now() - t) / 1000)
  if (ageS < 60) return `${Math.round(ageS)}s ago`
  if (ageS < 3600) return `${Math.round(ageS / 60)}m ago`
  if (ageS < 86400) return `${Math.round(ageS / 3600)}h ago`
  return `${Math.round(ageS / 86400)}d ago`
}
