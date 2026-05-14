'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  promoteAnnotationToGold,
  unmarkGold,
} from '@/lib/actions/gold-standards'
import { GoldBadge } from './gold-badge'

/**
 * Admin-side promote / unmark control for a trajectory's gold standard.
 *
 * Three states:
 *   1. No gold yet, admin viewer  → "Promote my annotation" button + form
 *   2. Gold exists, admin viewer  → GOLD badge + meta + Unmark button
 *   3. Gold exists, non-admin     → GOLD badge only (no controls)
 *
 * The Promote button is only useful when the admin has actually annotated
 * the trajectory themselves. The server action checks this and surfaces a
 * helpful error if not.
 *
 * Non-admin viewers see just the badge; they get no calibration data either
 * (that's enforced server-side).
 */
export function GoldPromoteClient({
  workspaceId,
  trajectoryId,
  isAdmin,
  gold,
}: {
  workspaceId: string
  trajectoryId: string
  isAdmin: boolean
  gold:
    | null
    | {
        id: string
        promotedAt: Date
        promotedBy: string | null
        explanation: string | null
        markCount: number
      }
}) {
  if (!gold && !isAdmin) return null

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: gold
          ? 'linear-gradient(135deg, oklch(0.99 0.02 90), oklch(0.98 0.04 85))'
          : 'var(--panel)',
        border: `1px solid ${gold ? 'oklch(0.85 0.13 75 / 0.5)' : 'var(--line)'}`,
      }}
    >
      {gold ? (
        <GoldDisplay
          workspaceId={workspaceId}
          trajectoryId={trajectoryId}
          gold={gold}
          isAdmin={isAdmin}
        />
      ) : (
        <PromoteForm
          workspaceId={workspaceId}
          trajectoryId={trajectoryId}
        />
      )}
    </div>
  )
}

function GoldDisplay({
  workspaceId,
  trajectoryId: _trajectoryId,
  gold,
  isAdmin,
}: {
  workspaceId: string
  trajectoryId: string
  gold: NonNullable<
    Parameters<typeof GoldPromoteClient>[0]['gold']
  >
  isAdmin: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function unmark() {
    if (
      !confirm(
        'Remove this trajectory\'s gold standard? Calibration scores against it will reset.',
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await unmarkGold({ workspaceId, goldId: gold.id })
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unmark failed.')
      }
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <GoldBadge />
          <span className="ts-12 mono" style={{ color: 'var(--mute)' }}>
            promoted{' '}
            <span style={{ color: 'var(--text)' }}>
              {gold.promotedAt.toISOString().slice(0, 10)}
            </span>
            {gold.promotedBy && (
              <>
                {' '}by{' '}
                <span style={{ color: 'var(--text)' }}>
                  {gold.promotedBy}
                </span>
              </>
            )}{' '}
            · {gold.markCount} mark{gold.markCount === 1 ? '' : 's'} frozen
          </span>
        </div>
        {isAdmin && (
          <button
            onClick={unmark}
            disabled={isPending}
            className="ts-11 mono"
            style={{
              background: 'transparent',
              border: '1px solid oklch(0.55 0.2 25 / 0.35)',
              borderRadius: 5,
              padding: '4px 10px',
              color: 'var(--danger)',
              cursor: isPending ? 'not-allowed' : 'pointer',
            }}
          >
            {isPending ? 'unmarking…' : 'unmark'}
          </button>
        )}
      </div>
      {gold.explanation && (
        <p
          className="ts-12 mt-2"
          style={{ color: 'var(--mute)', lineHeight: 1.5 }}
        >
          {gold.explanation}
        </p>
      )}
      {error && (
        <div
          className="ts-11 mono mt-2 rounded-md p-2"
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

function PromoteForm({
  workspaceId,
  trajectoryId,
}: {
  workspaceId: string
  trajectoryId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [explanation, setExplanation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  function promote() {
    setError(null)
    startTransition(async () => {
      try {
        await promoteAnnotationToGold({
          workspaceId,
          trajectoryId,
          explanation: explanation.trim() || undefined,
        })
        setOpen(false)
        setExplanation('')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Promote failed.')
      }
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="lbl" style={{ color: 'var(--mute2)' }}>
            GOLD STANDARD
          </div>
          <div
            className="ts-13 mt-0.5"
            style={{ color: 'var(--text)', lineHeight: 1.5 }}
          >
            No reference answer yet. Promote your annotation to freeze it
            as the gold standard — other raters&apos; marks will be
            calibrated against it.
          </div>
        </div>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="ts-12 mono shrink-0"
            style={{
              background: 'oklch(0.7 0.16 75)',
              color: 'white',
              border: '1px solid oklch(0.6 0.18 70)',
              borderRadius: 6,
              padding: '6px 12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            ★ promote to gold
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <label>
            <span className="lbl mb-1.5 block">explanation (optional)</span>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="What makes your answer the right one? e.g. 'The agent picked the most efficient tool but missed the user's intent on step 4.'"
              maxLength={2000}
              rows={3}
              className="w-full px-3 py-2 ts-13 rounded-md"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'var(--font-geist-sans), system-ui',
              }}
            />
          </label>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
              disabled={isPending}
              className="ts-12 mono"
              style={{
                background: 'transparent',
                border: '1px solid var(--line)',
                borderRadius: 5,
                padding: '6px 12px',
                color: 'var(--mute)',
                cursor: isPending ? 'not-allowed' : 'pointer',
              }}
            >
              cancel
            </button>
            <button
              onClick={promote}
              disabled={isPending}
              className="ts-12 mono"
              style={{
                background: 'oklch(0.7 0.16 75)',
                color: 'white',
                border: '1px solid oklch(0.6 0.18 70)',
                borderRadius: 6,
                padding: '6px 12px',
                fontWeight: 500,
                cursor: isPending ? 'not-allowed' : 'pointer',
              }}
            >
              {isPending ? 'promoting…' : '★ confirm promote'}
            </button>
          </div>
          {error && (
            <div
              className="ts-11 mono rounded-md p-2"
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
      )}
    </div>
  )
}
