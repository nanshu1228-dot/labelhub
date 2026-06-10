'use client'

import { useState, useTransition } from 'react'
import { reviewInviteReward } from '@/lib/actions/invite-rewards'
import type {
  InviteFunnel,
  ManualReviewRow,
} from '@/lib/queries/invite-rewards'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * Admin-only invite-reward dashboard panel for /workspaces/[id]/members
 * (Phase-13).
 *
 * Two views in one card:
 *   1. Funnel — invited → joined → 5-approved → granted (read-only)
 *   2. Manual-review queue — pending rows with approve / deny buttons
 *
 * Granted-amount totals roll up per currency. Money-path UI: every
 * action goes through the server action and triggers a soft refresh
 * (location.reload) so the admin sees their decision reflected in the
 * funnel + queue immediately.
 */
export function InviteFunnelPanel({
  funnel,
  queue,
}: {
  funnel: InviteFunnel
  queue: ManualReviewRow[]
}) {
  return (
    <section
      className="rounded-lg p-5 mt-6"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
        <div>
          <div className="lbl mb-0.5">§ INVITE FUNNEL</div>
          <h3 className="ts-16" style={{ color: 'var(--hi)' }}>
            Referral health
          </h3>
        </div>
        <div
          className="ts-12 mono flex gap-3 items-center"
          style={{ color: 'var(--mute)' }}
        >
          {Object.entries(funnel.grantedByCurrency).map(([cur, amt]) => (
            <span key={cur}>
              granted{' '}
              <strong
                className="ts-13"
                style={{ color: 'var(--success)' }}
              >
                {cur} {(amt / 100).toFixed(2)}
              </strong>
            </span>
          ))}
        </div>
      </div>

      <FunnelStrip funnel={funnel} />

      {queue.length > 0 && (
        <div className="mt-6">
          <div className="lbl mb-2" style={{ color: 'var(--mute)' }}>
            § MANUAL REVIEW QUEUE
          </div>
          <ul className="flex flex-col gap-2">
            {queue.map((row) => (
              <ManualReviewRow key={row.id} row={row} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function FunnelStrip({ funnel }: { funnel: InviteFunnel }) {
  const steps = [
    { label: 'invited', value: funnel.invited, tone: 'mute' as const },
    { label: 'joined', value: funnel.joined, tone: 'mute' as const },
    {
      label: '5-approved',
      value: funnel.completed,
      tone: 'accent' as const,
    },
    {
      label: 'granted',
      value: funnel.granted,
      tone: 'success' as const,
    },
    {
      label: 'manual review',
      value: funnel.pendingReview,
      tone: 'warn' as const,
    },
    { label: 'blocked', value: funnel.blocked, tone: 'danger' as const },
  ]
  return (
    <div
      className="grid gap-2"
      style={{
        gridTemplateColumns:
          'repeat(auto-fit, minmax(120px, 1fr))',
      }}
    >
      {steps.map((s) => (
        <Tile key={s.label} {...s} />
      ))}
    </div>
  )
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'mute' | 'accent' | 'success' | 'warn' | 'danger'
}) {
  const color = {
    mute: 'var(--text)',
    accent: 'var(--accent)',
    success: 'var(--success)',
    warn: 'oklch(0.55 0.14 75)',
    danger: 'var(--danger)',
  }[tone]
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--line)',
      }}
    >
      <div
        className="lbl mb-0.5"
        style={{ color: 'var(--mute2)' }}
      >
        {label}
      </div>
      <div
        className="ts-20 mono"
        style={{ color, fontWeight: 600 }}
      >
        {value}
      </div>
    </div>
  )
}

function ManualReviewRow({ row }: { row: ManualReviewRow }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [resolved, setResolved] = useState<string | null>(null)
  const [note, setNote] = useState('')

  function act(decision: 'approve' | 'deny') {
    setError(null)
    startTransition(async () => {
      try {
        const r = await reviewInviteReward({
          rewardId: row.id,
          decision,
          note: note.trim() || undefined,
        })
        setResolved(r.status)
        // Soft refresh after a beat so the admin sees their action
        // confirmed inline before the page rerenders.
        setTimeout(() => window.location.reload(), 600)
      } catch (e) {
        setError(
          getErrorMessage(e, 'Review failed.'),
        )
      }
    })
  }

  return (
    <li
      className="rounded-md p-3"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="ts-13 min-w-0">
          <div
            className="mono ts-12"
            style={{ color: 'var(--mute2)' }}
          >
            {row.status}
          </div>
          <div style={{ color: 'var(--text)' }}>
            <strong>
              {row.inviterDisplayName ??
                (row.inviterEmail
                  ? row.inviterEmail.split('@')[0]
                  : row.inviterUserId.slice(0, 8))}
            </strong>{' '}
            <span style={{ color: 'var(--mute2)' }}>invited</span>{' '}
            <strong>
              {row.inviteeDisplayName ??
                (row.inviteeEmail
                  ? row.inviteeEmail.split('@')[0]
                  : row.inviteeUserId.slice(0, 8))}
            </strong>
          </div>
          {row.blockReason && (
            <div
              className="ts-12 mono mt-1"
              style={{ color: 'var(--danger)' }}
            >
              ⚠ {row.blockReason}
            </div>
          )}
        </div>
        <div
          className="ts-13 mono"
          style={{ color: 'var(--success)', fontWeight: 600 }}
        >
          {row.currency} {(row.amountMinor / 100).toFixed(2)}
        </div>
      </div>

      {resolved ? (
        <div
          className="mt-3 ts-12 mono"
          style={{
            color:
              resolved === 'granted'
                ? 'var(--success)'
                : 'var(--danger)',
          }}
        >
          {resolved === 'granted'
            ? '✓ granted — wallet credited'
            : '✗ blocked — no money moved'}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional note (logged in audit)"
            className="ts-12 mono flex-1 min-w-[200px]"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 4,
              padding: '4px 8px',
              color: 'var(--text)',
            }}
            disabled={pending}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => act('approve')}
            className="ts-12 mono px-3 py-1 rounded"
            style={{
              background: 'var(--success-soft, oklch(0.65 0.18 200 / 0.1))',
              color: 'var(--success)',
              border: '1px solid var(--success)',
              cursor: pending ? 'wait' : 'pointer',
            }}
          >
            ✓ approve
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => act('deny')}
            className="ts-12 mono px-3 py-1 rounded"
            style={{
              background: 'oklch(0.55 0.2 25 / 0.1)',
              color: 'var(--danger)',
              border: '1px solid var(--danger)',
              cursor: pending ? 'wait' : 'pointer',
            }}
          >
            ✗ deny
          </button>
        </div>
      )}
      {error && (
        <div
          className="mt-2 ts-12 mono"
          style={{ color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}
    </li>
  )
}
