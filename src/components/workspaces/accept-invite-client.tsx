'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { acceptInvite } from '@/lib/actions/membership'

/**
 * The Accept button on /invites/[token].
 *
 * SSR side has already validated the invite + user-email match, so all
 * we do here is fire the action and route into the workspace on success.
 * On error: most likely a race (invite revoked between page load and click)
 * — surface the message in place.
 */
export function AcceptInviteClient({
  token,
  workspaceId,
}: {
  token: string
  workspaceId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function accept() {
    setError(null)
    startTransition(async () => {
      try {
        await acceptInvite({ token })
        router.push(`/workspaces/${workspaceId}`)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Accept failed.')
      }
    })
  }

  return (
    <div className="mt-6 flex flex-col gap-2">
      <button
        onClick={accept}
        disabled={isPending}
        className="lh-btn lh-btn-accent"
        style={{
          background: 'var(--accent)',
          color: 'white',
          border: '1px solid var(--accent)',
          borderRadius: 6,
          padding: '10px 16px',
          fontSize: 14,
          fontWeight: 500,
          cursor: isPending ? 'not-allowed' : 'pointer',
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? 'accepting…' : 'Accept invite'}
      </button>
      {error && (
        <div
          className="rounded-md p-2.5 ts-12 mt-2"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
