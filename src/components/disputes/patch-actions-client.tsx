'use client'
import { useState, useTransition } from 'react'
import {
  acceptPatchDemo,
  rejectPatchDemo,
} from '@/lib/actions/guideline-refiner'

/**
 * Accept / Reject buttons on pending patches. On accept we bump the
 * guideline version + append the patch; on reject the row is flagged but
 * preserved (audit + analytics).
 */
export function PatchActionsClient({
  workspaceId,
  patchId,
}: {
  workspaceId: string
  patchId: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const onAccept = () => {
    setError(null)
    startTransition(async () => {
      try {
        const { newVersion } = await acceptPatchDemo({ workspaceId, patchId })
        setDone(`merged → guideline v${newVersion}`)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to merge.')
      }
    })
  }

  const onReject = () => {
    setError(null)
    startTransition(async () => {
      try {
        await rejectPatchDemo({ workspaceId, patchId })
        setDone('rejected')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to reject.')
      }
    })
  }

  if (done) {
    return (
      <div className="ts-13 mono" style={{ color: 'var(--mute)' }}>
        {done}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={onAccept}
        disabled={pending}
        className="lh-btn lh-btn-sm lh-btn-accent"
      >
        {pending ? '…' : '✓ Merge into next guideline version'}
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={pending}
        className="lh-btn lh-btn-sm lh-btn-ghost"
      >
        ✗ Reject
      </button>
      {error && (
        <span className="ts-12 mono" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      )}
    </div>
  )
}
