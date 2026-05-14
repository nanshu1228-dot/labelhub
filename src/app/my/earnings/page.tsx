import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { getMyEarnings } from '@/lib/queries/billing'
import { EarningsDashboard } from '@/components/billing/earnings-dashboard'

export const metadata: Metadata = {
  title: 'My earnings — LabelHub',
}

// Force dynamic — wallet balances reflect real-time ledger state.
export const dynamic = 'force-dynamic'

/**
 * /my/earnings — annotator-facing dashboard.
 *
 * Shows:
 *   - Wallet balance(s) per (workspace, currency)
 *   - Pending earnings (approved line_items not yet rolled into a payout)
 *   - Recent payouts (with status / external ref)
 *   - Ledger (last 30 transactions)
 *   - Payment methods + add/remove/set-default UI
 *
 * Authenticated-only: earnings are personal financial data. Unauth visitors
 * get bounced to /signin with a return-to-here next param.
 */
export default async function MyEarningsPage() {
  const me = await optionalUser()
  if (!me) {
    redirect('/signin?next=/my/earnings')
  }
  const data = await getMyEarnings(me.id)
  return <EarningsDashboard data={data} userId={me.id} />
}
