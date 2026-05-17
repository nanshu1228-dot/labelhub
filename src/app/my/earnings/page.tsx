import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { getMyEarnings } from '@/lib/queries/billing'
import { getMyContribution } from '@/lib/queries/trust-consensus'
import { listMyInviteRewards } from '@/lib/queries/invite-rewards'
import { EarningsDashboard } from '@/components/billing/earnings-dashboard'
import { InviteRewardsSection } from '@/components/billing/invite-rewards-section'

export const metadata: Metadata = {
  title: 'My earnings — LabelHub',
}

// Force dynamic — wallet balances reflect real-time ledger state.
export const dynamic = 'force-dynamic'

/**
 * /my/earnings — annotator-facing dashboard.
 *
 * Shows:
 *   - Contribution (cold counts: submitted / approved / rejected / pending)
 *   - Wallet balance(s) per (workspace, currency)
 *   - Pending earnings (approved line_items not yet rolled into a payout)
 *   - Recent payouts (with status / external ref)
 *   - Ledger (last 30 transactions)
 *   - Payment methods + add/remove/set-default UI
 *
 * Deliberately does NOT show a trust score to the annotator — gamifying
 * quality creates perverse incentives (avoiding hard tasks, demoralization
 * at low scores, race-to-top inflation). Annotators see what they actually
 * did; admins judge quality privately on /workspaces/.../members.
 *
 * Authenticated-only: earnings are personal financial data. Unauth visitors
 * get bounced to /signin with a return-to-here next param.
 */
export default async function MyEarningsPage() {
  const me = await optionalUser()
  if (!me) {
    redirect('/signin?next=/my/earnings')
  }
  const [data, contribution, inviteRewards] = await Promise.all([
    getMyEarnings(me.id),
    getMyContribution({ userId: me.id }),
    listMyInviteRewards({ userId: me.id }).catch(() => []),
  ])
  return (
    <EarningsDashboard
      data={data}
      userId={me.id}
      contribution={contribution}
      inviteRewardsSlot={<InviteRewardsSection rows={inviteRewards} />}
    />
  )
}
