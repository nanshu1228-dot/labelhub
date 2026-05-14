'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { closePayoutPeriod } from '@/lib/actions/billing/close-period'
import { markPayoutPaid } from '@/lib/actions/billing/mark-paid'
import { formatMoneyMinor } from '@/lib/billing/calculate-payout'

/**
 * Publisher billing dashboard.
 *
 * Three sections:
 *   1. Open period — pending line items + "Close & batch" CTA
 *   2. Total spend by currency — paid vs pending stat cards
 *   3. Period history — chronological list with status + mark-paid actions
 */

interface BillingSummary {
  periods: Array<{
    id: string
    workspaceId: string
    periodStart: Date
    periodEnd: Date
    status: string
    closedAt: Date | null
    paidAt: Date | null
    createdAt: Date
  }>
  openPeriodSummary: {
    periodId: string
    periodStart: Date
    periodEnd: Date
    lineItemCount: number
    pendingTotalByCurrency: Array<{ currency: string; totalMinor: number }>
  } | null
  totalSpendByCurrency: Array<{
    currency: string
    totalMinor: number
    paidMinor: number
    pendingMinor: number
  }>
}

export function BillingDashboard({
  workspaceId,
  summary,
}: {
  workspaceId: string
  summary: BillingSummary
}) {
  return (
    <div className="space-y-8">
      <OpenPeriodSection
        workspaceId={workspaceId}
        openPeriod={summary.openPeriodSummary}
      />
      <SpendStatsSection
        totalSpendByCurrency={summary.totalSpendByCurrency}
      />
      <PeriodsListSection
        workspaceId={workspaceId}
        periods={summary.periods}
      />
    </div>
  )
}

function OpenPeriodSection({
  workspaceId,
  openPeriod,
}: {
  workspaceId: string
  openPeriod: BillingSummary['openPeriodSummary']
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function closePeriod() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        const r = await closePayoutPeriod({ workspaceId })
        setSuccess(
          `Closed period · ${r.payoutCount} payout${r.payoutCount === 1 ? '' : 's'} created`,
        )
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Close failed.')
      }
    })
  }

  if (!openPeriod) {
    return (
      <section>
        <SectionHeading
          label="OPEN PERIOD"
          title="No active billing period"
        />
        <p className="ts-13" style={{ color: 'var(--mute)' }}>
          A new period opens automatically when the first annotation is
          approved.
        </p>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="lbl">OPEN PERIOD</div>
          <h2
            className="ts-20 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            {openPeriod.lineItemCount} line item
            {openPeriod.lineItemCount === 1 ? '' : 's'} pending
          </h2>
          <div
            className="mono ts-12 mt-1"
            style={{ color: 'var(--mute2)' }}
          >
            started {openPeriod.periodStart.toISOString().slice(0, 10)} · auto-ends{' '}
            {openPeriod.periodEnd.toISOString().slice(0, 10)}
          </div>
        </div>
        <button
          onClick={closePeriod}
          disabled={isPending || openPeriod.lineItemCount === 0}
          className="lh-btn lh-btn-accent lh-btn-sm"
          style={{
            background: openPeriod.lineItemCount === 0 ? 'var(--panel2)' : 'var(--accent)',
            color: openPeriod.lineItemCount === 0 ? 'var(--mute2)' : 'white',
            border: `1px solid ${openPeriod.lineItemCount === 0 ? 'var(--line)' : 'var(--accent)'}`,
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 500,
            cursor: openPeriod.lineItemCount === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {isPending ? 'closing…' : 'close & batch payouts'}
        </button>
      </div>
      {error && (
        <div
          className="ts-12 mb-3"
          style={{ color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          className="ts-12 mb-3"
          style={{ color: 'var(--success)' }}
        >
          {success}
        </div>
      )}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        {openPeriod.pendingTotalByCurrency.map((c) => (
          <div
            key={c.currency}
            className="rounded-xl p-4"
            style={{
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-line)',
            }}
          >
            <div className="lbl">{c.currency} ACCRUED</div>
            <div
              className="mono mt-2"
              style={{ fontSize: 22, fontWeight: 500, color: 'var(--accent)' }}
            >
              {formatMoneyMinor(c.totalMinor, c.currency)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SpendStatsSection({
  totalSpendByCurrency,
}: {
  totalSpendByCurrency: BillingSummary['totalSpendByCurrency']
}) {
  if (totalSpendByCurrency.length === 0) return null
  return (
    <section>
      <SectionHeading
        label="LIFETIME SPEND"
        title="Total payouts created — paid vs pending"
      />
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
      >
        {totalSpendByCurrency.map((s) => (
          <div
            key={s.currency}
            className="rounded-xl p-4"
            style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
          >
            <div className="lbl">{s.currency}</div>
            <div
              className="mono mt-2"
              style={{ fontSize: 24, fontWeight: 500, color: 'var(--hi)' }}
            >
              {formatMoneyMinor(s.totalMinor, s.currency)}
            </div>
            <div
              className="ts-12 mt-2 flex items-center gap-3"
              style={{ color: 'var(--mute)' }}
            >
              <span>
                <span style={{ color: 'var(--success)', fontWeight: 500 }}>
                  {formatMoneyMinor(s.paidMinor, s.currency)}
                </span>{' '}
                paid
              </span>
              <span>·</span>
              <span>
                <span style={{ color: 'var(--warn)', fontWeight: 500 }}>
                  {formatMoneyMinor(s.pendingMinor, s.currency)}
                </span>{' '}
                pending
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function PeriodsListSection({
  workspaceId,
  periods,
}: {
  workspaceId: string
  periods: BillingSummary['periods']
}) {
  return (
    <section>
      <SectionHeading
        label="PERIODS"
        title="Recent billing periods"
      />
      {periods.length === 0 ? (
        <p className="ts-13" style={{ color: 'var(--mute)' }}>
          No periods yet. A period is auto-created when the first annotation
          in this workspace gets approved.
        </p>
      ) : (
        <div className="space-y-3">
          {periods.map((p) => (
            <PeriodRow
              key={p.id}
              workspaceId={workspaceId}
              period={p}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function PeriodRow({
  workspaceId,
  period,
}: {
  workspaceId: string
  period: BillingSummary['periods'][0]
}) {
  return (
    <Link
      href={`/workspaces/${workspaceId}/billing/${period.id}`}
      className="block rounded-xl p-4 hover:border-violet-300"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        textDecoration: 'none',
        transition: 'border-color 120ms',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PeriodStatusPill status={period.status} />
            <span
              className="mono ts-12"
              style={{ color: 'var(--text)' }}
            >
              {period.periodStart.toISOString().slice(0, 10)} →{' '}
              {period.periodEnd.toISOString().slice(0, 10)}
            </span>
          </div>
          <div
            className="mono ts-11 mt-1"
            style={{ color: 'var(--mute2)' }}
          >
            id {period.id.slice(0, 8)} · created{' '}
            {period.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
            {period.closedAt &&
              ` · closed ${period.closedAt.toISOString().slice(0, 16).replace('T', ' ')}`}
            {period.paidAt &&
              ` · paid ${period.paidAt.toISOString().slice(0, 16).replace('T', ' ')}`}
          </div>
        </div>
        <span
          className="ts-12 mono"
          style={{ color: 'var(--accent)' }}
        >
          drill in →
        </span>
      </div>
    </Link>
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

function PeriodStatusPill({ status }: { status: string }) {
  const variants: Record<string, { bg: string; fg: string; border: string }> = {
    open: {
      bg: 'var(--accent-soft)',
      fg: 'var(--accent)',
      border: 'var(--accent-line)',
    },
    closed: {
      bg: 'var(--warn-soft)',
      fg: 'var(--warn)',
      border: 'oklch(0.6 0.14 75 / 0.4)',
    },
    paid: {
      bg: 'var(--success-soft)',
      fg: 'var(--success)',
      border: 'oklch(0.5 0.13 150 / 0.35)',
    },
  }
  const v = variants[status] ?? variants.open
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

// Re-export Mark-paid helper used by detail page (kept here so it
// can be imported from the same component module).
export function MarkPaidButton({
  payoutId,
  disabled,
}: {
  payoutId: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  function go() {
    setErr(null)
    startTransition(async () => {
      try {
        await markPayoutPaid({ payoutId })
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Mark paid failed.')
      }
    })
  }
  return (
    <div>
      <button
        onClick={go}
        disabled={isPending || disabled}
        className="ts-12 mono"
        style={{
          background: 'var(--success-soft)',
          color: 'var(--success)',
          border: '1px solid oklch(0.5 0.13 150 / 0.35)',
          borderRadius: 5,
          padding: '4px 10px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {isPending ? 'marking…' : 'mark paid'}
      </button>
      {err && (
        <div className="ts-11 mt-1" style={{ color: 'var(--danger)' }}>
          {err}
        </div>
      )}
    </div>
  )
}
