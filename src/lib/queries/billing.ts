import 'server-only'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  paymentMethods,
  payoutLineItems,
  payoutPeriods,
  payouts,
  transactions,
  walletBalance,
} from '@/lib/db/schema'

/**
 * Read-side helpers for the billing UI surfaces.
 *
 * All exports are read-only DB selects; no side effects, no caching beyond
 * the database. The page handlers cache via Next's RSC layer.
 */

// ─── Annotator side ─────────────────────────────────────────────────────

/**
 * `/my/earnings` data bundle.
 *
 * Returns:
 *   - wallets       : one entry per (workspace, currency) the user has a balance in
 *   - methods       : the user's payment methods
 *   - recentPayouts : last 20 payout rows (any status), most recent first
 *   - recentTxns    : last 30 ledger entries, most recent first
 *
 * "Pending earnings" (approved line_items not yet rolled into a payout) is
 * computed separately because the row layout differs.
 */
export async function getMyEarnings(userId: string) {
  const db = getDb()

  const [wallets, methods, recentPayouts, recentTxns] = await Promise.all([
    db
      .select()
      .from(walletBalance)
      .where(eq(walletBalance.userId, userId))
      .orderBy(desc(walletBalance.lastSettledAt)),
    db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.userId, userId))
      .orderBy(desc(paymentMethods.isDefault), desc(paymentMethods.createdAt)),
    db
      .select()
      .from(payouts)
      .where(eq(payouts.userId, userId))
      .orderBy(desc(payouts.createdAt))
      .limit(20),
    db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.ts))
      .limit(30),
  ])

  // Pending earnings: line_items with status='approved' that haven't been
  // rolled into a payouts row yet. We approximate by checking that the
  // line's payoutPeriodId has no payouts row for this user — the period
  // is still open.
  const pendingLines = await db
    .select({
      id: payoutLineItems.id,
      periodId: payoutLineItems.payoutPeriodId,
      totalAmountMinor: payoutLineItems.totalAmountMinor,
      currency: payoutLineItems.currency,
      annotationId: payoutLineItems.annotationId,
      createdAt: payoutLineItems.createdAt,
      periodStatus: payoutPeriods.status,
    })
    .from(payoutLineItems)
    .leftJoin(
      payoutPeriods,
      eq(payoutLineItems.payoutPeriodId, payoutPeriods.id),
    )
    .where(
      and(
        eq(payoutLineItems.userId, userId),
        eq(payoutLineItems.status, 'approved'),
      ),
    )
    .orderBy(desc(payoutLineItems.createdAt))
    .limit(50)

  const pending = pendingLines.filter((p) => p.periodStatus === 'open')

  // Aggregate pending by currency
  const pendingByCurrency = new Map<
    string,
    { totalMinor: number; itemCount: number }
  >()
  for (const p of pending) {
    const cur = pendingByCurrency.get(p.currency) ?? {
      totalMinor: 0,
      itemCount: 0,
    }
    cur.totalMinor += p.totalAmountMinor
    cur.itemCount += 1
    pendingByCurrency.set(p.currency, cur)
  }

  return {
    wallets,
    methods,
    recentPayouts,
    recentTxns,
    pendingItems: pending,
    pendingByCurrency: [...pendingByCurrency.entries()].map(
      ([currency, v]) => ({ currency, ...v }),
    ),
  }
}

// ─── Publisher side ────────────────────────────────────────────────────

/**
 * `/workspaces/[id]/billing` data bundle.
 *
 * Returns:
 *   - periods       : last 12 payout periods (any status)
 *   - openPeriodSummary : aggregate of the currently-open period if any
 *   - totalSpendByCurrency : total spent ever, per currency
 *   - recentEvents  : last 30 billing-related events for this workspace
 */
export async function getWorkspaceBillingSummary(workspaceId: string) {
  const db = getDb()

  const [periodsList, totalSpend] = await Promise.all([
    db
      .select()
      .from(payoutPeriods)
      .where(eq(payoutPeriods.workspaceId, workspaceId))
      .orderBy(desc(payoutPeriods.createdAt))
      .limit(12),
    db
      .select({
        currency: payouts.currency,
        totalMinor: payouts.amountMinor,
        status: payouts.status,
      })
      .from(payouts)
      .leftJoin(
        payoutPeriods,
        eq(payouts.payoutPeriodId, payoutPeriods.id),
      )
      .where(eq(payoutPeriods.workspaceId, workspaceId)),
  ])

  // Aggregate spend by (currency, status).
  const totalSpendByCurrency = new Map<
    string,
    { totalMinor: number; paidMinor: number; pendingMinor: number }
  >()
  for (const r of totalSpend) {
    const cur = totalSpendByCurrency.get(r.currency) ?? {
      totalMinor: 0,
      paidMinor: 0,
      pendingMinor: 0,
    }
    cur.totalMinor += r.totalMinor
    if (r.status === 'paid') cur.paidMinor += r.totalMinor
    else if (r.status === 'pending' || r.status === 'processing') {
      cur.pendingMinor += r.totalMinor
    }
    totalSpendByCurrency.set(r.currency, cur)
  }

  // Open-period aggregate (pending line items not yet rolled up)
  const [openPeriod] = await db
    .select()
    .from(payoutPeriods)
    .where(
      and(
        eq(payoutPeriods.workspaceId, workspaceId),
        eq(payoutPeriods.status, 'open'),
      ),
    )
    .limit(1)

  let openPeriodSummary: {
    periodId: string
    periodStart: Date
    periodEnd: Date
    lineItemCount: number
    pendingTotalByCurrency: Array<{ currency: string; totalMinor: number }>
  } | null = null

  if (openPeriod) {
    const openLines = await db
      .select({
        currency: payoutLineItems.currency,
        totalAmountMinor: payoutLineItems.totalAmountMinor,
      })
      .from(payoutLineItems)
      .where(
        and(
          eq(payoutLineItems.payoutPeriodId, openPeriod.id),
          eq(payoutLineItems.status, 'approved'),
        ),
      )
    const agg = new Map<string, number>()
    for (const l of openLines) {
      agg.set(l.currency, (agg.get(l.currency) ?? 0) + l.totalAmountMinor)
    }
    openPeriodSummary = {
      periodId: openPeriod.id,
      periodStart: openPeriod.periodStart,
      periodEnd: openPeriod.periodEnd,
      lineItemCount: openLines.length,
      pendingTotalByCurrency: [...agg.entries()].map(([currency, totalMinor]) => ({
        currency,
        totalMinor,
      })),
    }
  }

  return {
    periods: periodsList,
    openPeriodSummary,
    totalSpendByCurrency: [...totalSpendByCurrency.entries()].map(
      ([currency, v]) => ({ currency, ...v }),
    ),
  }
}

/**
 * Detail view: every payout in a single period, with annotator info.
 */
export async function getPeriodDetail(
  workspaceId: string,
  periodId: string,
) {
  const db = getDb()
  const [period] = await db
    .select()
    .from(payoutPeriods)
    .where(
      and(
        eq(payoutPeriods.id, periodId),
        eq(payoutPeriods.workspaceId, workspaceId),
      ),
    )
    .limit(1)
  if (!period) return null

  const periodPayouts = await db
    .select()
    .from(payouts)
    .where(eq(payouts.payoutPeriodId, periodId))
    .orderBy(desc(payouts.amountMinor))

  const periodLineItems = await db
    .select()
    .from(payoutLineItems)
    .where(eq(payoutLineItems.payoutPeriodId, periodId))
    .orderBy(desc(payoutLineItems.createdAt))
    .limit(200)

  return { period, payouts: periodPayouts, lineItems: periodLineItems }
}

/**
 * Currency-agnostic suppressed-zero check used by both UIs.
 */
export function isNonZeroByCurrency(
  list: ReadonlyArray<{ totalMinor: number }>,
): boolean {
  return list.some((r) => r.totalMinor !== 0)
}

// Silence "unused" lint when sometimes I only want one helper:
void isNull
