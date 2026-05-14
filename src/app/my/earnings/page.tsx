import type { Metadata } from 'next'
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
 * Demo mode: always acts as the seeded DEMO_USER_ID. Once real auth lands
 * this becomes `await requireUser()` + use the returned user.id.
 */
const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001'

export default async function MyEarningsPage() {
  const data = await getMyEarnings(DEMO_USER_ID)
  return <EarningsDashboard data={data} userId={DEMO_USER_ID} />
}
