'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Loader2 } from 'lucide-react'
import { archiveTask } from '@/lib/actions/tasks'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * Owner control for taking a task offline while preserving all collected data.
 */
export function ArchiveTaskButton({
  taskId,
  status,
}: {
  taskId: string
  status: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  if (status === 'archived') {
    return (
      <span
        className="ts-11 mono inline-flex items-center gap-1.5 rounded px-2"
        style={{
          minHeight: 40,
          background: 'var(--panel2)',
          color: 'var(--mute2)',
          border: '1px solid var(--line)',
        }}
      >
        <Archive size={14} />
        Archived
      </span>
    )
  }

  function go() {
    setError(null)
    setConfirming(true)
  }

  function confirmArchive() {
    setError(null)
    startTransition(async () => {
      try {
        await archiveTask({ taskId })
        setConfirming(false)
        router.refresh()
      } catch (e) {
        setError(getErrorMessage(e, 'Archive failed.'))
      }
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="ts-12 mono inline-flex items-center justify-center gap-2 rounded px-3"
        style={{
          minHeight: 40,
          background: 'transparent',
          color: 'var(--mute)',
          border: '1px solid var(--line)',
          fontWeight: 600,
          cursor: pending ? 'not-allowed' : 'pointer',
          opacity: pending ? 0.55 : 1,
        }}
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
        Archive
      </button>
      {error ? (
        <span className="ts-11 mono" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      ) : null}
      {confirming ? (
        <span
          className="inline-flex flex-wrap items-center gap-2 rounded px-2 py-1"
          style={{
            minHeight: 40,
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
          }}
        >
          <span className="ts-11" style={{ color: 'var(--text)' }}>
            Archive this task? New claims stop, existing data remains available.
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            className="ts-11 mono rounded px-2"
            style={{
              minHeight: 28,
              color: 'var(--mute)',
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={confirmArchive}
            className="ts-11 mono rounded px-2"
            style={{
              minHeight: 28,
              color: 'white',
              background: 'var(--danger)',
              border: '1px solid var(--danger)',
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            Archive
          </button>
        </span>
      ) : null}
    </span>
  )
}
