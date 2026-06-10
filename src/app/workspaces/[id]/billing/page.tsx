import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import {
  getWorkspaceBillingSummary,
  getWorkspaceWalletSummary,
  getWorkspaceWithdrawals,
  listWorkspaceMembersBasic,
} from '@/lib/queries/billing'
import {
  optionalUser,
  requireWorkspaceAdmin,
} from '@/lib/auth/guards'
import { BillingDashboard } from '@/components/billing/billing-dashboard'
import { AccountCreditCard } from '@/components/billing/account-credit-card'
import { WalletSummary } from '@/components/billing/wallet-summary'
import { WithdrawalQueue } from '@/components/billing/withdrawal-queue'

export const metadata: Metadata = {
  title: 'Billing — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/billing — publisher-facing settlement dashboard.
 *
 * Shows:
 *   - Open period status (line item count + total pending) + "Close & batch payouts" CTA
 *   - Recent periods with per-period status + total + drill-in
 *   - Total spend per currency: paid vs pending
 *   - Per-period detail: payouts × annotators × line items + "Mark paid" admin button
 *
 * Admin-only when real auth lands. For demo we don't gate.
 */
export default async function WorkspaceBillingPage(
  props: PageProps<'/workspaces/[id]/billing'>,
) {
  const { id: workspaceId } = await props.params

  // Access control: workspace admin only. Billing data (line items, payouts,
  // member wallet sums) is financial PII — never expose to annotators or
  // non-members. Unauth → /signin, non-admin → notFound (don't leak
  // existence to a wrong-tenant viewer).
  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${workspaceId}/billing`)
  try {
    await requireWorkspaceAdmin(workspaceId)
  } catch {
    notFound()
  }

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()
  const [summary, walletSummary, withdrawals, members] = await Promise.all([
    getWorkspaceBillingSummary(workspaceId),
    getWorkspaceWalletSummary(workspaceId),
    getWorkspaceWithdrawals(workspaceId),
    listWorkspaceMembersBasic(workspaceId),
  ])
  // Serialize Dates to ISO for the client withdrawal queue.
  const withdrawalRows = withdrawals.map((w) => ({
    ...w,
    createdAt: w.createdAt.toISOString(),
    reviewedAt: w.reviewedAt ? w.reviewedAt.toISOString() : null,
  }))
  return (
    <div className="app-light min-h-screen" style={{ background: 'var(--bg)' }}>
      <Header workspaceId={workspaceId} workspaceName={workspace.name} />
      <main className="mx-auto max-w-[1200px] px-6 py-8 flex flex-col gap-6">
        <WalletSummary summary={walletSummary} />
        <AccountCreditCard workspaceId={workspaceId} members={members} />
        <WithdrawalQueue requests={withdrawalRows} />
        <BillingDashboard
          workspaceId={workspaceId}
          summary={summary}
        />
      </main>
    </div>
  )
}

function Header({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string
  workspaceName: string
}) {
  return (
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
            className="truncate-1 hover:underline"
            style={{ color: 'var(--text)', maxWidth: 200 }}
          >
            {workspaceName}
          </Link>
          <span>/</span>
          <span style={{ color: 'var(--hi)' }}>billing</span>
        </nav>
        <Link href="/" className="ts-13 mono" style={{ color: 'var(--hi)' }}>
          <span style={{ color: 'var(--accent)' }}>§</span> labelhub
        </Link>
      </div>
    </header>
  )
}
