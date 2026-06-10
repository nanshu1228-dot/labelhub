import type { WorkspaceWalletSummary } from '@/lib/queries/billing'
import { formatMoneyMinor } from '@/lib/billing/calculate-payout'

/**
 * Admin wallet / withdrawal overview (server component, no hooks).
 *
 * One card per currency showing:
 *   - outstanding wallet liabilities owed to workspace members
 *   - count + total of pending (status='requested') withdrawal requests
 *
 * Money values are minor units — formatMoneyMinor divides by 100 for display.
 */
export function WalletSummary({
  summary,
}: {
  summary: WorkspaceWalletSummary
}) {
  const { byCurrency } = summary
  return (
    <section
      className="rounded-xl p-4"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div className="lbl mb-1">§ WALLET LIABILITIES</div>
      <p className="ts-13 mb-3" style={{ color: 'var(--mute)' }}>
        Total withdrawable balance held for members, plus withdrawal requests
        awaiting your decision.
      </p>
      {byCurrency.length === 0 ? (
        <p className="ts-13" style={{ color: 'var(--mute)' }}>
          No member balances yet. Credit an account below to get started.
        </p>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
        >
          {byCurrency.map((c) => (
            <div
              key={c.currency}
              className="rounded-xl p-4"
              style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}
            >
              <div className="lbl">{c.currency} OWED</div>
              <div
                className="mono mt-2"
                style={{ fontSize: 24, fontWeight: 500, color: 'var(--hi)' }}
              >
                {formatMoneyMinor(c.liabilityMinor, c.currency)}
              </div>
              <div
                className="ts-12 mt-2"
                style={{ color: 'var(--mute)' }}
              >
                {c.pendingWithdrawalCount === 0 ? (
                  <span>no pending withdrawals</span>
                ) : (
                  <span>
                    <span style={{ color: 'var(--warn)', fontWeight: 500 }}>
                      {c.pendingWithdrawalCount}
                    </span>{' '}
                    pending withdrawal
                    {c.pendingWithdrawalCount === 1 ? '' : 's'} ·{' '}
                    <span style={{ color: 'var(--warn)', fontWeight: 500 }}>
                      {formatMoneyMinor(c.pendingWithdrawalMinor, c.currency)}
                    </span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
