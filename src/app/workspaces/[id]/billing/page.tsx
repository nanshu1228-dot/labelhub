import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getWorkspaceBillingSummary } from '@/lib/queries/billing'
import { BillingDashboard } from '@/components/billing/billing-dashboard'

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
  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()
  const summary = await getWorkspaceBillingSummary(workspaceId)
  return (
    <div className="app-light min-h-screen" style={{ background: 'var(--bg)' }}>
      <Header workspaceId={workspaceId} workspaceName={workspace.name} />
      <main className="mx-auto max-w-[1200px] px-6 py-8">
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
