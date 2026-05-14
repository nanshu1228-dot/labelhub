import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getPeriodDetail } from '@/lib/queries/billing'
import { formatMoneyMinor } from '@/lib/billing/calculate-payout'
import { MarkPaidButton } from '@/components/billing/billing-dashboard'

export const metadata: Metadata = {
  title: 'Payout period — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/billing/[periodId] — single-period drill-in.
 *
 * One block per annotator showing their payout amount + status + a
 * "Mark paid" button. Below: the underlying line items table so admins
 * can spot-check what drove the total.
 */
export default async function PeriodDetailPage(
  props: PageProps<'/workspaces/[id]/billing/[periodId]'>,
) {
  const { id: workspaceId, periodId } = await props.params
  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()
  const detail = await getPeriodDetail(workspaceId, periodId)
  if (!detail) notFound()
  const { period, payouts, lineItems } = detail

  return (
    <div className="app-light min-h-screen" style={{ background: 'var(--bg)' }}>
      <header
        className="hairline-b sticky top-0 z-10"
        style={{ background: 'var(--panel)' }}
      >
        <div className="mx-auto max-w-[1200px] flex items-center justify-between px-6 py-3">
          <nav
            className="ts-12 mono flex items-center gap-1.5 min-w-0"
            style={{ color: 'var(--mute2)' }}
          >
            <Link
              href={`/workspaces/${workspaceId}`}
              className="hover:underline"
              style={{ color: 'var(--text)' }}
            >
              {workspace.name}
            </Link>
            <span>/</span>
            <Link
              href={`/workspaces/${workspaceId}/billing`}
              className="hover:underline"
              style={{ color: 'var(--text)' }}
            >
              billing
            </Link>
            <span>/</span>
            <span style={{ color: 'var(--hi)' }}>
              period {periodId.slice(0, 8)}
            </span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 py-8 space-y-8">
        <section>
          <div className="lbl">PAYOUT PERIOD</div>
          <h1
            className="ts-24 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            {period.periodStart.toISOString().slice(0, 10)} →{' '}
            {period.periodEnd.toISOString().slice(0, 10)}
          </h1>
          <div
            className="mono ts-12 mt-2"
            style={{ color: 'var(--mute2)' }}
          >
            status={period.status} · {payouts.length} payout
            {payouts.length === 1 ? '' : 's'} · {lineItems.length} line item
            {lineItems.length === 1 ? '' : 's'}
          </div>
        </section>

        <section>
          <div className="lbl mb-3">PAYOUTS</div>
          {payouts.length === 0 ? (
            <p className="ts-13" style={{ color: 'var(--mute)' }}>
              No payouts in this period. Close the period from the parent
              billing page to materialize line items into payout rows.
            </p>
          ) : (
            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
              }}
            >
              <table className="w-full ts-13 mono">
                <thead
                  style={{
                    color: 'var(--mute2)',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  <tr>
                    <th className="text-left p-3">payout</th>
                    <th className="text-left p-3">annotator</th>
                    <th className="text-right p-3">amount</th>
                    <th className="text-left p-3">status</th>
                    <th className="text-right p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr
                      key={p.id}
                      style={{ borderTop: '1px solid var(--line)' }}
                    >
                      <td className="p-3" style={{ color: 'var(--mute)' }}>
                        {p.id.slice(0, 8)}
                      </td>
                      <td className="p-3" style={{ color: 'var(--text)' }}>
                        {p.userId.slice(0, 8)}
                      </td>
                      <td
                        className="p-3 text-right"
                        style={{ color: 'var(--hi)', fontWeight: 500 }}
                      >
                        {formatMoneyMinor(p.amountMinor, p.currency)}
                      </td>
                      <td className="p-3">
                        <PayoutPill status={p.status} />
                      </td>
                      <td className="p-3 text-right">
                        {p.status === 'pending' ? (
                          <MarkPaidButton payoutId={p.id} />
                        ) : (
                          <span
                            className="ts-11 mono"
                            style={{ color: 'var(--mute2)' }}
                          >
                            {p.paidAt
                              ? `paid ${p.paidAt
                                  .toISOString()
                                  .slice(0, 16)
                                  .replace('T', ' ')}`
                              : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <div className="lbl mb-3">LINE ITEMS · {lineItems.length}</div>
          {lineItems.length === 0 ? (
            <p className="ts-13" style={{ color: 'var(--mute)' }}>
              No line items in this period.
            </p>
          ) : (
            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
              }}
            >
              <table className="w-full ts-12 mono">
                <thead
                  style={{
                    color: 'var(--mute2)',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  <tr>
                    <th className="text-left p-2">annotation</th>
                    <th className="text-left p-2">annotator</th>
                    <th className="text-right p-2">base</th>
                    <th className="text-right p-2">×mult</th>
                    <th className="text-right p-2">bonus</th>
                    <th className="text-right p-2">penalty</th>
                    <th className="text-right p-2">total</th>
                    <th className="text-left p-2">status</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((l) => (
                    <tr
                      key={l.id}
                      style={{ borderTop: '1px solid var(--line)' }}
                    >
                      <td className="p-2" style={{ color: 'var(--mute)' }}>
                        {l.annotationId.slice(0, 8)}
                      </td>
                      <td className="p-2" style={{ color: 'var(--mute)' }}>
                        {l.userId.slice(0, 8)}
                      </td>
                      <td
                        className="p-2 text-right"
                        style={{ color: 'var(--text)' }}
                      >
                        {formatMoneyMinor(l.baseAmountMinor, l.currency)}
                      </td>
                      <td
                        className="p-2 text-right"
                        style={{ color: 'var(--mute)' }}
                      >
                        {(l.qualityMultiplierBp / 100).toFixed(2)}×
                      </td>
                      <td
                        className="p-2 text-right"
                        style={{
                          color:
                            l.bonusAmountMinor > 0
                              ? 'var(--success)'
                              : 'var(--mute2)',
                        }}
                      >
                        +{formatMoneyMinor(l.bonusAmountMinor, l.currency)}
                      </td>
                      <td
                        className="p-2 text-right"
                        style={{
                          color:
                            l.penaltyAmountMinor > 0
                              ? 'var(--danger)'
                              : 'var(--mute2)',
                        }}
                      >
                        −{formatMoneyMinor(l.penaltyAmountMinor, l.currency)}
                      </td>
                      <td
                        className="p-2 text-right"
                        style={{ color: 'var(--hi)', fontWeight: 500 }}
                      >
                        {formatMoneyMinor(l.totalAmountMinor, l.currency)}
                      </td>
                      <td
                        className="p-2"
                        style={{ color: 'var(--mute2)' }}
                      >
                        {l.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function PayoutPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; border: string }> = {
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
  const v = map[status] ?? map.pending
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
