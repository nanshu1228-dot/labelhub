'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react'

export type ExportJobLiveState = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | string
  byteSize: number | null
  rowCount: number | null
  storagePath: string | null
  errorText: string | null
}

type PollResponse = {
  id: string
  status: ExportJobLiveState['status']
  byteSize: number | null
  rowCount: number | null
  downloadUrl?: string | null
  error?: string | null
}

export function ExportJobLiveCells({ job }: { job: ExportJobLiveState }) {
  const [state, setState] = useState(job)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [isDownloading, startDownload] = useTransition()
  const active = state.status === 'pending' || state.status === 'running'

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/export/jobs/${job.id}`, {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        if (!res.ok) return
        const next = (await res.json()) as PollResponse
        if (cancelled) return
        setState((prev) => ({
          ...prev,
          status: next.status,
          byteSize: next.byteSize ?? prev.byteSize,
          rowCount: next.rowCount ?? prev.rowCount,
          errorText: next.error ?? prev.errorText,
          storagePath:
            next.status === 'completed' ? (prev.storagePath ?? 'ready') : prev.storagePath,
        }))
      } catch {
        // Keep the stale status visible; the next interval can recover.
      }
    }
    void poll()
    const timer = window.setInterval(poll, 2_500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active, job.id])

  const action = useMemo(() => {
    if (state.status === 'failed') {
      return (
        <span className="ts-11" style={{ color: 'var(--danger)' }}>
          {state.errorText?.slice(0, 60) ?? 'failed'}
        </span>
      )
    }
    if (state.status === 'completed') {
      return (
        <button
          type="button"
          className="ts-12 mono inline-flex items-center gap-2 rounded px-3"
          disabled={isDownloading}
          onClick={() => {
            setDownloadError(null)
            startDownload(async () => {
              try {
                const res = await fetch(`/api/export/jobs/${job.id}`, {
                  cache: 'no-store',
                  headers: { accept: 'application/json' },
                })
                const body = (await res.json()) as PollResponse
                if (!res.ok || !body.downloadUrl) {
                  setDownloadError(body.error ?? 'Download URL unavailable.')
                  return
                }
                window.location.assign(body.downloadUrl)
              } catch {
                setDownloadError('Download URL unavailable.')
              }
            })
          }}
          style={{
            minHeight: 36,
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent-line)',
            color: 'var(--accent)',
          }}
        >
          {isDownloading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          Download
        </button>
      )
    }
    return (
      <span
        className="ts-11 mono inline-flex items-center gap-1"
        style={{ color: 'var(--mute2)' }}
      >
        <RefreshCw size={13} className="animate-spin" />
        polling
      </span>
    )
  }, [isDownloading, job.id, state.errorText, state.status])

  return (
    <>
      <td className="px-2 py-2 align-top">
        <StatusBadge status={state.status} error={state.errorText} />
      </td>
      <td className="px-2 py-2 align-top">
        <div className="flex flex-col gap-1">
          {action}
          {downloadError ? (
            <span className="ts-11" style={{ color: 'var(--danger)' }}>
              {downloadError}
            </span>
          ) : null}
        </div>
      </td>
    </>
  )
}

function StatusBadge({
  status,
  error,
}: {
  status: ExportJobLiveState['status']
  error: string | null
}) {
  const tone = statusTone(status)
  const Icon =
    status === 'completed'
      ? CheckCircle2
      : status === 'failed'
        ? XCircle
        : status === 'running'
          ? Loader2
          : Clock3
  return (
    <span
      className="ts-11 mono inline-flex items-center gap-1 rounded px-2"
      style={{
        minHeight: 26,
        background: tone.background,
        color: tone.color,
        border: `1px solid ${tone.border}`,
      }}
      title={error ?? undefined}
    >
      <Icon size={13} className={status === 'running' ? 'animate-spin' : ''} />
      {status}
    </span>
  )
}

function statusTone(status: ExportJobLiveState['status']) {
  if (status === 'completed') {
    return {
      background: 'var(--success-soft)',
      color: 'var(--success)',
      border: 'oklch(0.65 0.13 150 / 0.38)',
    }
  }
  if (status === 'failed') {
    return {
      background: 'var(--danger-soft)',
      color: 'var(--danger)',
      border: 'oklch(0.6 0.2 25 / 0.34)',
    }
  }
  if (status === 'running') {
    return {
      background: 'var(--accent-soft)',
      color: 'var(--accent)',
      border: 'var(--accent-line)',
    }
  }
  return {
    background: 'var(--panel2)',
    color: 'var(--mute)',
    border: 'var(--line)',
  }
}
