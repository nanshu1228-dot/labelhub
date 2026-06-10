'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  addPaymentMethod,
  removePaymentMethod,
  setDefaultPaymentMethod,
} from '@/lib/actions/billing/payment-methods'
import { requestWithdraw } from '@/lib/actions/billing/withdraw'
import { formatMoneyMinor } from '@/lib/billing/calculate-payout'
import type { MyContribution } from '@/lib/queries/trust-consensus'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * Annotator earnings dashboard.
 *
 * Three sections:
 *   1. Wallets — one card per (workspace × currency) with balance + withdraw CTA
 *   2. Pending — items approved but not yet rolled into a payout
 *   3. History — recent payouts + ledger
 *   4. Payment methods — add / remove / set default
 *
 * Reads server-loaded data verbatim; mutations go through Server Actions.
 */

interface DashboardData {
  wallets: Array<{
    id: string
    userId: string
    workspaceId: string | null
    currency: string
    balanceMinor: number
    lastSettledAt: Date
  }>
  methods: Array<{
    id: string
    userId: string
    type: string
    destination: string
    label: string | null
    verifiedAt: Date | null
    isDefault: boolean
    createdAt: Date
  }>
  recentPayouts: Array<{
    id: string
    payoutPeriodId: string
    userId: string
    amountMinor: number
    currency: string
    status: string
    paymentMethodId: string | null
    externalRef: string | null
    paidAt: Date | null
    failedAt: Date | null
    failureReason: string | null
    createdAt: Date
  }>
  recentTxns: Array<{
    id: string
    userId: string
    type: string
    amountMinor: number
    currency: string
    workspaceId: string | null
    refTable: string | null
    refId: string | null
    memo: string | null
    ts: Date
  }>
  pendingItems: Array<{
    id: string
    periodId: string
    totalAmountMinor: number
    currency: string
    annotationId: string
    createdAt: Date
    periodStatus: string | null
  }>
  pendingByCurrency: Array<{
    currency: string
    totalMinor: number
    itemCount: number
  }>
}

interface MyWithdrawal {
  id: string
  workspaceId: string
  amountMinor: number
  currency: string
  status: string
  decisionMemo: string | null
  externalRef: string | null
  reviewedAt: Date | null
  createdAt: Date
}

export function EarningsDashboard({
  data,
  withdrawals = [],
  userId: _userId,
  contribution,
  inviteRewardsSlot,
}: {
  data: DashboardData
  /** The user's own withdrawal requests (any status), newest first. */
  withdrawals?: MyWithdrawal[]
  userId: string
  /** Cold counts — submitted / approved / rejected / pending review. NO score. */
  contribution: MyContribution
  /** Server-rendered slot for InviteRewardsSection (Phase-13). Kept as
   *  a slot prop instead of an internal fetch so this dashboard stays
   *  presentational + the page-level data fetches all live together. */
  inviteRewardsSlot?: React.ReactNode
}) {
  return (
    // The /my layout already provides the `.app-light` shell + AppHeader,
    // so this dashboard stays a plain <main> — rendering its own header
    // here previously produced two stacked nav bars.
    <main className="mx-auto max-w-[1200px] px-6 py-8 space-y-8">
      <ContributionSection contribution={contribution} />
        <WalletsSection wallets={data.wallets} methods={data.methods} />
        <WithdrawalRequestsSection withdrawals={withdrawals} />
        <PendingSection
          pendingByCurrency={data.pendingByCurrency}
          pendingItems={data.pendingItems}
        />
        {inviteRewardsSlot}
        <PayoutHistorySection recentPayouts={data.recentPayouts} />
        <LedgerSection recentTxns={data.recentTxns} />
        <PaymentMethodsSection methods={data.methods} />
    </main>
  )
}

function WithdrawalRequestsSection({
  withdrawals,
}: {
  withdrawals: MyWithdrawal[]
}) {
  if (withdrawals.length === 0) return null
  return (
    <section>
      <SectionHeading label="WITHDRAWALS" title="Your withdrawal requests" />
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <div className="overflow-x-auto">
        <table className="w-full ts-12 mono min-w-[560px]">
          <thead
            style={{ color: 'var(--mute2)', borderBottom: '1px solid var(--line)' }}
          >
            <tr>
              <th className="text-left p-2">requested</th>
              <th className="text-right p-2">amount</th>
              <th className="text-left p-2">status</th>
              <th className="text-left p-2">reviewed</th>
              <th className="text-left p-2">note</th>
            </tr>
          </thead>
          <tbody>
            {withdrawals.map((w) => {
              // A request is "decided" once an admin has acted on it. We treat
              // anything that's no longer the initial open state as decided so
              // we can surface the decision memo / rejection reason + the time
              // it was reviewed.
              const decided =
                w.status !== 'requested' && w.status !== 'pending'
              // On a rejected row the decisionMemo is the rejection reason; on
              // approved/paid rows it's the reviewer's memo (if any). externalRef
              // is the synthetic receipt on a paid row.
              const note =
                w.decisionMemo ?? (decided ? w.externalRef : null) ?? '—'
              return (
                <tr key={w.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="p-2" style={{ color: 'var(--mute2)' }}>
                    {w.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="p-2 text-right" style={{ color: 'var(--hi)' }}>
                    {formatMoneyMinor(w.amountMinor, w.currency)}
                  </td>
                  <td className="p-2">
                    <WithdrawalStatusChip status={w.status} />
                  </td>
                  <td className="p-2" style={{ color: 'var(--mute2)' }}>
                    {decided && w.reviewedAt
                      ? w.reviewedAt
                          .toISOString()
                          .slice(0, 16)
                          .replace('T', ' ')
                      : '—'}
                  </td>
                  <td
                    className="p-2"
                    style={{
                      color:
                        w.status === 'rejected'
                          ? 'var(--danger)'
                          : 'var(--mute)',
                      maxWidth: 320,
                    }}
                  >
                    {note}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>
      <p className="ts-11 mt-2" style={{ color: 'var(--mute2)' }}>
        A request holds nothing until an admin approves it — your balance only
        drops when an approved withdrawal is committed to the ledger. Once an
        admin decides, the reviewed time and any note (a rejection reason or a
        payout receipt) appear above.
      </p>
    </section>
  )
}

/**
 * Status chip for a withdrawal request lifecycle (requested → approved → paid,
 * or → rejected / cancelled). Mirrors the tone map used elsewhere but renders
 * a filled chip so a decided row reads at a glance.
 */
function WithdrawalStatusChip({ status }: { status: string }) {
  const variants: Record<string, { bg: string; fg: string; border: string }> = {
    requested: {
      bg: 'var(--warn-soft)',
      fg: 'var(--warn)',
      border: 'oklch(0.6 0.14 75 / 0.4)',
    },
    pending: {
      bg: 'var(--warn-soft)',
      fg: 'var(--warn)',
      border: 'oklch(0.6 0.14 75 / 0.4)',
    },
    approved: {
      bg: 'var(--accent-soft)',
      fg: 'var(--accent)',
      border: 'var(--accent-line)',
    },
    paid: {
      bg: 'var(--success-soft)',
      fg: 'var(--success)',
      border: 'oklch(0.5 0.13 150 / 0.35)',
    },
    rejected: {
      bg: 'var(--danger-soft)',
      fg: 'var(--danger)',
      border: 'oklch(0.55 0.2 25 / 0.35)',
    },
    cancelled: {
      bg: 'var(--panel2)',
      fg: 'var(--mute)',
      border: 'var(--line)',
    },
  }
  const v = variants[status] ?? variants.requested
  return (
    <span
      className="mono ts-11"
      style={{
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.border}`,
        padding: '1px 6px',
        borderRadius: 4,
        fontWeight: 500,
      }}
    >
      {status}
    </span>
  )
}

/**
 * Cold contribution counts. NO smoothed score, NO percentage — just the raw
 * numbers so the annotator can see "I did N pieces of work" without being
 * graded back. Quality judgment is private to admins (see Members page).
 */
function ContributionSection({
  contribution,
}: {
  contribution: MyContribution
}) {
  return (
    <section>
      <SectionHeading
        label="CONTRIBUTION"
        title="What you&rsquo;ve submitted"
      />
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
      >
        <CountTile
          label="submitted"
          value={contribution.submitted}
          hint="Annotations you marked complete."
        />
        <CountTile
          label="approved"
          value={contribution.approved}
          hint="Admin accepted — counts toward your payout."
          tone="success"
        />
        <CountTile
          label="pending review"
          value={contribution.pendingReview}
          hint="Waiting for admin to review."
          tone="muted"
        />
        <CountTile
          label="rejected"
          value={contribution.rejected}
          hint="Admin sent it back. Check feedback in /inbox."
          tone={contribution.rejected > 0 ? 'warn' : 'muted'}
        />
      </div>
      <p
        className="ts-11 mt-2"
        style={{ color: 'var(--mute2)', maxWidth: 600 }}
      >
        These are counts of what you did — there&rsquo;s no rating you can
        see. Quality is judged privately by workspace admins; if you want
        feedback on a rejected piece, check the rejection note on the
        annotation in /inbox.
      </p>
    </section>
  )
}

function CountTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: number
  hint?: string
  tone?: 'default' | 'success' | 'warn' | 'muted'
}) {
  const color =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'warn'
        ? 'var(--warn)'
        : tone === 'muted'
          ? 'var(--mute)'
          : 'var(--hi)'
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div
        className="lbl mb-1.5"
        style={{ color: 'var(--mute2)' }}
      >
        {label}
      </div>
      <div className="ts-24 mono" style={{ color, fontWeight: 600 }}>
        {value}
      </div>
      {hint && (
        <div className="ts-11 mt-1" style={{ color: 'var(--mute2)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}

function WalletsSection({
  wallets,
  methods,
}: {
  wallets: DashboardData['wallets']
  methods: DashboardData['methods']
}) {
  if (wallets.length === 0) {
    return (
      <section>
        <SectionHeading label="WALLET" title="No wallets yet" />
        <div
          className="rounded-xl p-6 ts-13"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            color: 'var(--mute)',
          }}
        >
          You haven&apos;t earned anything yet. Once your first annotation is
          approved, a wallet will be created automatically.
        </div>
      </section>
    )
  }
  return (
    <section>
      <SectionHeading label="WALLET" title="Available balance" />
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
      >
        {wallets.map((w) => (
          <WalletCard key={w.id} wallet={w} methods={methods} />
        ))}
      </div>
    </section>
  )
}

function WalletCard({
  wallet,
  methods,
}: {
  wallet: DashboardData['wallets'][0]
  methods: DashboardData['methods']
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Any saved method can receive a payout in the demo loop (verification is
  // not required), and a withdrawal can be requested with no method at all —
  // the admin approves it regardless.
  const payoutMethods = methods
  const [pmId, setPmId] = useState(
    payoutMethods.find((m) => m.isDefault)?.id ?? payoutMethods[0]?.id ?? '',
  )

  function submit() {
    setError(null)
    setSuccess(null)
    const major = Number(amount)
    if (!Number.isFinite(major) || major <= 0) {
      setError('Enter an amount greater than 0.')
      return
    }
    if (!wallet.workspaceId) {
      setError('Wallet has no workspace context.')
      return
    }
    const amountMinor = Math.floor(major * 100)
    startTransition(async () => {
      try {
        const r = await requestWithdraw({
          workspaceId: wallet.workspaceId!,
          paymentMethodId: pmId || undefined,
          amountMinor,
          currency: wallet.currency,
        })
        setSuccess(
          `Withdrawal requested — ${formatMoneyMinor(r.amountMinor, r.currency)} pending admin approval.`,
        )
        setShowWithdraw(false)
        setAmount('')
        router.refresh()
      } catch (e) {
        setError(getErrorMessage(e, 'Withdraw failed.'))
      }
    })
  }

  return (
    <article
      className="rounded-xl p-4"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
    >
      <div className="lbl">{wallet.currency} BALANCE</div>
      <div
        className="mono mt-2"
        style={{ fontSize: 28, fontWeight: 500, color: 'var(--hi)' }}
      >
        {formatMoneyMinor(wallet.balanceMinor, wallet.currency)}
      </div>
      <div
        className="ts-12 mono mt-1"
        style={{ color: 'var(--mute2)' }}
      >
        workspace {wallet.workspaceId?.slice(0, 8) ?? '—'} · synced{' '}
        {wallet.lastSettledAt.toISOString().slice(0, 16).replace('T', ' ')}
      </div>

      {showWithdraw ? (
        <div className="mt-4 space-y-2">
          {payoutMethods.length > 0 && (
            <select
              value={pmId}
              onChange={(e) => setPmId(e.target.value)}
              className="w-full px-2 py-1.5 ts-12 mono rounded"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
              }}
            >
              <option value="">— no payout method (request only) —</option>
              {payoutMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.type}:{m.destination.slice(0, 20)}…
                  {m.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          )}
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder={`amount in ${wallet.currency}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-2 py-1.5 ts-13 mono rounded"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
            }}
          />
          {error && (
            <div className="ts-12" style={{ color: 'var(--danger)' }}>
              {error}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={submit}
              disabled={isPending}
              className="lh-btn lh-btn-accent lh-btn-sm"
              style={{
                background: 'var(--accent)',
                color: 'white',
                border: '1px solid var(--accent)',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 12,
              }}
            >
              {isPending ? 'submitting…' : 'request withdraw'}
            </button>
            <button
              onClick={() => setShowWithdraw(false)}
              className="ts-12 mono"
              style={{
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
                color: 'var(--mute)',
              }}
            >
              cancel
            </button>
          </div>
          <p className="ts-11" style={{ color: 'var(--mute2)' }}>
            Sends a request to the workspace admin for approval — your balance
            doesn&apos;t change until it&apos;s approved.
          </p>
        </div>
      ) : (
        <button
          onClick={() => setShowWithdraw(true)}
          className="mt-3 ts-12 mono"
          style={{
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-line)',
            borderRadius: 6,
            padding: '6px 12px',
            cursor: wallet.balanceMinor > 0 ? 'pointer' : 'not-allowed',
            opacity: wallet.balanceMinor > 0 ? 1 : 0.5,
          }}
          disabled={wallet.balanceMinor <= 0}
        >
          withdraw →
        </button>
      )}
      {success && (
        <div
          className="ts-12 mt-2"
          style={{ color: 'var(--success)' }}
        >
          {success}
        </div>
      )}
    </article>
  )
}

function PendingSection({
  pendingByCurrency,
  pendingItems,
}: {
  pendingByCurrency: DashboardData['pendingByCurrency']
  pendingItems: DashboardData['pendingItems']
}) {
  if (pendingByCurrency.length === 0) {
    return (
      <section>
        <SectionHeading
          label="PENDING"
          title="No earnings waiting on the current period"
        />
        <p className="ts-13" style={{ color: 'var(--mute)' }}>
          Approved annotations from the current open period accrue here until
          the admin closes the period and creates a payout.
        </p>
      </section>
    )
  }
  return (
    <section>
      <SectionHeading
        label="PENDING"
        title="Accrued in the current open period"
      />
      <div
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        {pendingByCurrency.map((p) => (
          <div
            key={p.currency}
            className="rounded-xl p-4"
            style={{
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-line)',
            }}
          >
            <div className="lbl">{p.currency} PENDING</div>
            <div
              className="mono mt-2"
              style={{ fontSize: 22, fontWeight: 500, color: 'var(--accent)' }}
            >
              {formatMoneyMinor(p.totalMinor, p.currency)}
            </div>
            <div
              className="ts-12 mono mt-1"
              style={{ color: 'var(--mute2)' }}
            >
              {p.itemCount} item{p.itemCount === 1 ? '' : 's'}
            </div>
          </div>
        ))}
      </div>
      <details className="ts-12 mono" style={{ color: 'var(--mute)' }}>
        <summary
          className="cursor-pointer"
          style={{ color: 'var(--mute)' }}
        >
          show {pendingItems.length} line items
        </summary>
        <div className="overflow-x-auto">
        <table className="mt-2 w-full min-w-[420px]">
          <thead>
            <tr style={{ color: 'var(--mute2)' }}>
              <th className="text-left p-1">annotation</th>
              <th className="text-right p-1">amount</th>
              <th className="text-right p-1">accrued</th>
            </tr>
          </thead>
          <tbody>
            {pendingItems.map((item) => (
              <tr key={item.id} className="hairline-b">
                <td
                  className="p-1"
                  style={{ color: 'var(--text)' }}
                >
                  {item.annotationId.slice(0, 8)}
                </td>
                <td
                  className="p-1 text-right"
                  style={{ color: 'var(--hi)' }}
                >
                  {formatMoneyMinor(item.totalAmountMinor, item.currency)}
                </td>
                <td
                  className="p-1 text-right"
                  style={{ color: 'var(--mute2)' }}
                >
                  {item.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </details>
    </section>
  )
}

function PayoutHistorySection({
  recentPayouts,
}: {
  recentPayouts: DashboardData['recentPayouts']
}) {
  return (
    <section>
      <SectionHeading label="PAYOUTS" title="History" />
      {recentPayouts.length === 0 ? (
        <p className="ts-13" style={{ color: 'var(--mute)' }}>
          No payouts yet. Once a period closes, your approved line items will
          show up here.
        </p>
      ) : (
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
        >
          <div className="overflow-x-auto">
          <table className="w-full ts-12 mono min-w-[520px]">
            <thead
              style={{
                color: 'var(--mute2)',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <tr>
                <th className="text-left p-2">payout</th>
                <th className="text-left p-2">period</th>
                <th className="text-right p-2">amount</th>
                <th className="text-left p-2">status</th>
                <th className="text-left p-2">paid at</th>
              </tr>
            </thead>
            <tbody>
              {recentPayouts.map((p) => (
                <tr
                  key={p.id}
                  style={{ borderTop: '1px solid var(--line)' }}
                >
                  <td className="p-2" style={{ color: 'var(--mute)' }}>
                    {p.id.slice(0, 8)}
                  </td>
                  <td className="p-2" style={{ color: 'var(--mute)' }}>
                    {p.payoutPeriodId.slice(0, 8)}
                  </td>
                  <td
                    className="p-2 text-right"
                    style={{ color: 'var(--hi)' }}
                  >
                    {formatMoneyMinor(p.amountMinor, p.currency)}
                  </td>
                  <td className="p-2">
                    <StatusPill status={p.status} />
                  </td>
                  <td className="p-2" style={{ color: 'var(--mute2)' }}>
                    {p.paidAt
                      ? p.paidAt.toISOString().slice(0, 16).replace('T', ' ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </section>
  )
}

function LedgerSection({
  recentTxns,
}: {
  recentTxns: DashboardData['recentTxns']
}) {
  if (recentTxns.length === 0) return null
  return (
    <section>
      <SectionHeading label="LEDGER" title="Recent transactions" />
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <div className="overflow-x-auto">
        <table className="w-full ts-12 mono min-w-[480px]">
          <thead
            style={{
              color: 'var(--mute2)',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <tr>
              <th className="text-left p-2">when</th>
              <th className="text-left p-2">type</th>
              <th className="text-right p-2">amount</th>
              <th className="text-left p-2">memo</th>
            </tr>
          </thead>
          <tbody>
            {recentTxns.map((t) => (
              <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td className="p-2" style={{ color: 'var(--mute2)' }}>
                  {t.ts.toISOString().slice(0, 16).replace('T', ' ')}
                </td>
                <td className="p-2" style={{ color: 'var(--mute)' }}>
                  {t.type}
                </td>
                <td
                  className="p-2 text-right"
                  style={{
                    color: t.amountMinor >= 0 ? 'var(--success)' : 'var(--danger)',
                    fontWeight: 500,
                  }}
                >
                  {t.amountMinor >= 0 ? '+' : ''}
                  {formatMoneyMinor(t.amountMinor, t.currency)}
                </td>
                <td
                  className="p-2 trunc-1"
                  style={{ color: 'var(--mute)', maxWidth: 360 }}
                >
                  {t.memo ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  )
}

function PaymentMethodsSection({
  methods,
}: {
  methods: DashboardData['methods']
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showAdd, setShowAdd] = useState(false)
  const [type, setType] = useState<'usdt' | 'alipay' | 'wechat' | 'bank' | 'stripe'>(
    'usdt',
  )
  const [destination, setDestination] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  function add() {
    setError(null)
    startTransition(async () => {
      try {
        await addPaymentMethod({ type, destination, label: label || undefined })
        setShowAdd(false)
        setDestination('')
        setLabel('')
        router.refresh()
      } catch (e) {
        setError(getErrorMessage(e, 'Add failed.'))
      }
    })
  }

  function remove(id: string) {
    startTransition(async () => {
      try {
        await removePaymentMethod({ paymentMethodId: id })
        router.refresh()
      } catch (e) {
        setError(getErrorMessage(e, 'Remove failed.'))
      }
    })
  }

  function setDefault(id: string) {
    startTransition(async () => {
      try {
        await setDefaultPaymentMethod({ paymentMethodId: id })
        router.refresh()
      } catch (e) {
        setError(getErrorMessage(e, 'Set default failed.'))
      }
    })
  }

  return (
    <section>
      <SectionHeading
        label="PAYMENT METHODS"
        title="Where you get paid"
      />
      {methods.length === 0 && !showAdd && (
        <p
          className="ts-13 mb-3"
          style={{ color: 'var(--mute)' }}
        >
          Add a payment method to enable withdrawals.
        </p>
      )}
      {methods.length > 0 && (
        <div className="space-y-2 mb-3">
          {methods.map((m) => (
            <div
              key={m.id}
              className="rounded-md p-3 flex items-center justify-between"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="lbl"
                    style={{
                      color: m.isDefault ? 'var(--accent)' : 'var(--mute2)',
                    }}
                  >
                    {m.type}
                  </span>
                  {m.isDefault && (
                    <span
                      className="ts-11 mono"
                      style={{
                        color: 'var(--accent)',
                        background: 'var(--accent-soft)',
                        border: '1px solid var(--accent-line)',
                        padding: '1px 6px',
                        borderRadius: 4,
                      }}
                    >
                      default
                    </span>
                  )}
                  {m.verifiedAt && (
                    <span
                      className="ts-11 mono"
                      style={{
                        color: 'var(--success)',
                        background: 'var(--success-soft)',
                        border: '1px solid oklch(0.5 0.13 150 / 0.35)',
                        padding: '1px 6px',
                        borderRadius: 4,
                      }}
                    >
                      verified
                    </span>
                  )}
                  {m.label && (
                    <span
                      className="ts-12"
                      style={{ color: 'var(--mute)' }}
                    >
                      · {m.label}
                    </span>
                  )}
                </div>
                <div
                  className="mono ts-12 mt-1 trunc-1"
                  style={{ color: 'var(--text)' }}
                >
                  {m.destination}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                {!m.isDefault && (
                  <button
                    onClick={() => setDefault(m.id)}
                    disabled={isPending}
                    className="ts-12 mono"
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--line)',
                      borderRadius: 5,
                      padding: '4px 8px',
                      color: 'var(--mute)',
                      cursor: 'pointer',
                    }}
                  >
                    make default
                  </button>
                )}
                <button
                  onClick={() => remove(m.id)}
                  disabled={isPending}
                  className="ts-12 mono"
                  style={{
                    background: 'transparent',
                    border: '1px solid oklch(0.55 0.2 25 / 0.35)',
                    borderRadius: 5,
                    padding: '4px 8px',
                    color: 'var(--danger)',
                    cursor: 'pointer',
                  }}
                >
                  remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showAdd ? (
        <div
          className="rounded-md p-4 space-y-2"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
        >
          <div className="flex items-center gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className="px-2 py-1.5 ts-12 mono rounded"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
              }}
            >
              <option value="usdt">USDT (TRC20 / ERC20)</option>
              <option value="alipay">Alipay</option>
              <option value="wechat">WeChat Pay</option>
              <option value="bank">Bank account</option>
              <option value="stripe">Stripe Connect</option>
            </select>
            <input
              placeholder={
                type === 'usdt'
                  ? 'Txxxxx… or 0xxxxx…'
                  : type === 'stripe'
                    ? 'acct_xxxxx…'
                    : 'email / phone / acct'
              }
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="flex-1 px-2 py-1.5 ts-12 mono rounded"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
              }}
            />
          </div>
          <input
            placeholder="optional label e.g. 'Main USDT'"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full px-2 py-1.5 ts-12 mono rounded"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
            }}
          />
          {error && (
            <div className="ts-12" style={{ color: 'var(--danger)' }}>
              {error}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={add}
              disabled={isPending}
              className="ts-12 mono"
              style={{
                background: 'var(--accent)',
                color: 'white',
                border: '1px solid var(--accent)',
                borderRadius: 6,
                padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              {isPending ? 'adding…' : 'add method'}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="ts-12 mono"
              style={{
                background: 'transparent',
                border: 0,
                color: 'var(--mute)',
                cursor: 'pointer',
              }}
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="ts-12 mono"
          style={{
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: '8px 16px',
            color: 'var(--text)',
            cursor: 'pointer',
          }}
        >
          + add payment method
        </button>
      )}
    </section>
  )
}

function SectionHeading({
  label,
  title,
}: {
  label: string
  title: string
}) {
  return (
    <div className="mb-3">
      <div className="lbl">{label}</div>
      <h2
        className="ts-20 mt-1"
        style={{ color: 'var(--hi)', fontWeight: 500 }}
      >
        {title}
      </h2>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const variants: Record<string, { bg: string; fg: string; border: string }> = {
    pending: {
      bg: 'var(--warn-soft)',
      fg: 'var(--warn)',
      border: 'oklch(0.6 0.14 75 / 0.4)',
    },
    paid: {
      bg: 'var(--success-soft)',
      fg: 'var(--success)',
      border: 'oklch(0.5 0.13 150 / 0.35)',
    },
    processing: {
      bg: 'var(--accent-soft)',
      fg: 'var(--accent)',
      border: 'var(--accent-line)',
    },
    failed: {
      bg: 'var(--danger-soft)',
      fg: 'var(--danger)',
      border: 'oklch(0.55 0.2 25 / 0.35)',
    },
    reversed: {
      bg: 'var(--panel2)',
      fg: 'var(--mute)',
      border: 'var(--line)',
    },
  }
  const v = variants[status] ?? variants.pending
  return (
    <span
      className="mono ts-11"
      style={{
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.border}`,
        padding: '1px 6px',
        borderRadius: 4,
      }}
    >
      {status}
    </span>
  )
}
