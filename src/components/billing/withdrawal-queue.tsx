'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  reviewWithdrawal,
  markWithdrawalPaid,
} from '@/lib/actions/billing/review-withdrawal'
import { formatMoneyMinor } from '@/lib/billing/calculate-payout'

/**
 * Admin withdrawal queue (operable payment loop, step 4).
 *
 * Pending ('requested') rows get Approve / Reject; approved rows get a
 * Mark-paid button. Approve writes the negative ledger row (the debit lands
 * here); reject leaves the balance untouched; mark-paid stamps a synthetic
 * receipt. No real payment rail.
 */
type Req = {
  id: string
  userId: string
  email: string | null
  displayName: string | null
  amountMinor: number
  currency: string
  status: string
  decisionMemo: string | null
  externalRef: string | null
  reviewedAt: string | null
  createdAt: string
}

function fmtTs(iso: string | null): string {
  if (!iso) return '—'
  // Stored ISO timestamps; show the same yyyy-mm-dd hh:mm slice used across
  // the billing UI. Guard against a value that isn't a parseable ISO string.
  const t = iso.slice(0, 16).replace('T', ' ')
  return t || '—'
}

const STATUS_TONE: Record<string, string> = {
  requested: 'var(--warn)',
  approved: 'var(--accent)',
  paid: 'var(--success)',
  rejected: 'var(--mute)',
  cancelled: 'var(--mute)',
}

export function WithdrawalQueue({ requests }: { requests: Req[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, start] = useTransition()

  function run(id: string, fn: () => Promise<unknown>) {
    setError(null)
    setBusyId(id)
    start(async () => {
      try {
        await fn()
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusyId(null)
      }
    })
  }

  const pending = requests.filter((r) => r.status === 'requested')
  const rest = requests.filter((r) => r.status !== 'requested')

  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div
        className="px-4 py-2.5 flex items-baseline justify-between hairline-b"
        style={{ background: 'var(--panel2)' }}
      >
        <div className="lbl">§ WITHDRAWAL REQUESTS</div>
        <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
          {pending.length} pending / {requests.length} total
        </span>
      </div>

      {error && (
        <p
          className="px-4 py-2 ts-12"
          style={{ color: 'var(--danger)', background: 'var(--danger-soft)' }}
        >
          {error}
        </p>
      )}

      {requests.length === 0 ? (
        <p className="px-4 py-6 ts-13 text-center" style={{ color: 'var(--mute)' }}>
          No withdrawal requests yet.
        </p>
      ) : (
        <ul>
          {[...pending, ...rest].map((r, i) => {
            const busy = busyId === r.id
            const decided = r.status !== 'requested'
            return (
              <li
                key={r.id}
                className="px-4 py-3"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className="ts-13 truncate-1"
                    style={{ color: 'var(--hi)', minWidth: 160, flex: 1 }}
                    title={r.email ?? r.userId}
                  >
                    {r.displayName || r.email || r.userId.slice(0, 8)}
                  </span>
                  <span
                    className="ts-13 mono"
                    style={{ color: 'var(--text)', minWidth: 120 }}
                  >
                    {formatMoneyMinor(r.amountMinor, r.currency)}
                  </span>
                  <span
                    className="badge"
                    style={{
                      color: STATUS_TONE[r.status] ?? 'var(--mute)',
                      borderColor: 'var(--line2)',
                    }}
                  >
                    {r.status}
                  </span>
                  {r.externalRef && (
                    <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
                      {r.externalRef}
                    </span>
                  )}
                  <span className="flex items-center gap-2 ml-auto">
                    {r.status === 'requested' && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run(r.id, () =>
                              reviewWithdrawal({ requestId: r.id, decision: 'approve' }),
                            )
                          }
                          className="ts-12 mono"
                          style={{
                            padding: '3px 10px',
                            border: '1px solid var(--accent-line)',
                            borderRadius: 5,
                            background: 'var(--accent-soft)',
                            color: 'var(--accent)',
                            cursor: busy ? 'wait' : 'pointer',
                            fontWeight: 600,
                          }}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const memo =
                              window.prompt('Rejection reason (optional):') ?? undefined
                            run(r.id, () =>
                              reviewWithdrawal({
                                requestId: r.id,
                                decision: 'reject',
                                memo: memo?.trim() || undefined,
                              }),
                            )
                          }}
                          className="ts-12 mono"
                          style={{
                            padding: '3px 10px',
                            border: '1px solid var(--line)',
                            borderRadius: 5,
                            background: 'transparent',
                            color: 'var(--danger)',
                            cursor: busy ? 'wait' : 'pointer',
                          }}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {r.status === 'approved' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(r.id, () => markWithdrawalPaid({ requestId: r.id }))
                        }
                        className="ts-12 mono"
                        style={{
                          padding: '3px 10px',
                          border: '1px solid oklch(0.65 0.13 150 / 0.4)',
                          borderRadius: 5,
                          background: 'var(--success-soft)',
                          color: 'var(--success)',
                          cursor: busy ? 'wait' : 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Mark paid
                      </button>
                    )}
                  </span>
                </div>
                {/* Metadata line. Always show the requested time + requester
                    email; on decided rows also surface the reviewed time and
                    any decision memo (rejection reason / reviewer note). */}
                <div
                  className="ts-11 mono mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"
                  style={{ color: 'var(--mute2)' }}
                >
                  <span>requested {fmtTs(r.createdAt)}</span>
                  {r.email && (
                    <span className="truncate-1" title={r.email}>
                      · {r.email}
                    </span>
                  )}
                  {decided && r.reviewedAt && (
                    <span>· reviewed {fmtTs(r.reviewedAt)}</span>
                  )}
                  {decided && r.decisionMemo && (
                    <span
                      style={{
                        color:
                          r.status === 'rejected'
                            ? 'var(--danger)'
                            : 'var(--mute)',
                      }}
                    >
                      · {r.decisionMemo}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
