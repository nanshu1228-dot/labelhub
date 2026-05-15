'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { publishTask } from '@/lib/actions/tasks'

/**
 * Single button: flips a `draft` task to `open` so annotators can pick
 * up topics. Disabled outside of `draft` status — server enforces this
 * too, but we surface it client-side for clarity.
 */
export function PublishTaskButton({
  taskId,
  status,
}: {
  taskId: string
  status: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (status === 'open') {
    return (
      <span
        className="ts-11 mono px-2 py-0.5 rounded"
        style={{
          background: 'oklch(0.65 0.18 200 / 0.12)',
          color: 'oklch(0.65 0.18 200)',
          border: '1px solid oklch(0.65 0.18 200 / 0.35)',
        }}
      >
        published
      </span>
    )
  }
  if (status === 'archived') {
    return (
      <span
        className="ts-11 mono px-2 py-0.5 rounded"
        style={{
          background: 'var(--panel2)',
          color: 'var(--mute2)',
          border: '1px solid var(--line)',
        }}
      >
        archived
      </span>
    )
  }

  function go() {
    setError(null)
    startTransition(async () => {
      try {
        await publishTask({ taskId })
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Publish failed.')
      }
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={go}
        disabled={pending}
        className="ts-12 mono"
        style={{
          background: 'var(--accent)',
          color: 'white',
          border: '1px solid var(--accent)',
          borderRadius: 5,
          padding: '3px 10px',
          fontWeight: 500,
          cursor: pending ? 'not-allowed' : 'pointer',
          opacity: pending ? 0.5 : 1,
        }}
      >
        {pending ? 'publishing…' : 'publish task'}
      </button>
      {error && (
        <span className="ts-11 mono" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      )}
    </span>
  )
}
