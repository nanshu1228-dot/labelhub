'use server'

/**
 * Close the active payout period for a workspace.
 *
 * Pipeline:
 *
 *   1. Take the (single) `payout_periods` row where status='open' for the workspace.
 *   2. Sum approved `payout_line_items` belonging to it, grouped by (user_id, currency).
 *   3. Insert one `payouts` row per (user × currency) with status='pending'.
 *      The aggregator is per-currency because nothing prevents a workspace from
 *      running cash-per-item in CNY for one task and token mode in USDT for another.
 *   4. Flip the period's status to 'closed' and stamp closed_at.
 *
 * After this fires, ANY new approval lands in a freshly-created next period
 * (ensureActivePeriod() will lazily insert it on the next approval).
 *
 * Idempotency: re-running close() on an already-closed period is a no-op
 * with a clear error code so admin tooling can render "already closed".
 *
 * Admin-only (token-gated for demo; real `requireWorkspaceAdmin` when auth lands).
 */

import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import {
  events,
  payoutLineItems,
  payoutPeriods,
  payouts,
} from '@/lib/db/schema'
import { AppError, NotFoundError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'

function assertDemoMode(): void {
  if (process.env.LABELHUB_DEMO_MODE !== 'true') {
    throw new AppError(
      'DEMO_MODE_DISABLED',
      'Billing actions require LABELHUB_DEMO_MODE=true while real auth is pending.',
      403,
    )
  }
}

const inputSchema = z.object({
  workspaceId: uuidLike,
  /**
   * Specific period to close. When omitted, closes whichever period is
   * currently 'open' for this workspace (the typical admin flow).
   */
  payoutPeriodId: uuidLike.optional(),
})

export interface ClosePeriodResult {
  ok: true
  payoutPeriodId: string
  /** Number of `payouts` rows just created from this close. */
  payoutCount: number
  /** Grand total, summed across all currencies. Only useful as a sanity check. */
  grandTotalMinorAcrossCurrencies: number
  /** Per-currency breakdown for UI confirmation. */
  byCurrency: Array<{ currency: string; userCount: number; totalMinor: number }>
}

export async function closePayoutPeriod(
  input: z.infer<typeof inputSchema>,
): Promise<ClosePeriodResult> {
  assertDemoMode()
  const parsed = inputSchema.parse(input)
  const db = getDb()

  // ── 1. Resolve the period to close ─────────────────────────────────
  let periodRow: typeof payoutPeriods.$inferSelect | null = null
  if (parsed.payoutPeriodId) {
    const [r] = await db
      .select()
      .from(payoutPeriods)
      .where(
        and(
          eq(payoutPeriods.id, parsed.payoutPeriodId),
          eq(payoutPeriods.workspaceId, parsed.workspaceId),
        ),
      )
      .limit(1)
    periodRow = r ?? null
  } else {
    const [r] = await db
      .select()
      .from(payoutPeriods)
      .where(
        and(
          eq(payoutPeriods.workspaceId, parsed.workspaceId),
          eq(payoutPeriods.status, 'open'),
        ),
      )
      .limit(1)
    periodRow = r ?? null
  }
  if (!periodRow) throw new NotFoundError('Payout period')

  if (periodRow.status !== 'open') {
    throw new AppError(
      'PERIOD_NOT_OPEN',
      `Payout period ${periodRow.id} is already ${periodRow.status}; nothing to close.`,
      400,
    )
  }

  // ── 2. Aggregate approved line items by (user, currency) ──────────
  const aggregates = await db
    .select({
      userId: payoutLineItems.userId,
      currency: payoutLineItems.currency,
      totalMinor: sql<number>`sum(${payoutLineItems.totalAmountMinor})::int`,
      lineCount: sql<number>`count(*)::int`,
    })
    .from(payoutLineItems)
    .where(
      and(
        eq(payoutLineItems.payoutPeriodId, periodRow.id),
        eq(payoutLineItems.status, 'approved'),
      ),
    )
    .groupBy(payoutLineItems.userId, payoutLineItems.currency)

  // ── 3. Insert one payouts row per (user × currency) ──────────────
  // Filter zero-amount aggregates: don't pollute payouts with $0 rows.
  const insertable = aggregates.filter((a) => Number(a.totalMinor) > 0)

  if (insertable.length > 0) {
    await db.insert(payouts).values(
      insertable.map((a) => ({
        payoutPeriodId: periodRow.id,
        userId: a.userId,
        amountMinor: Number(a.totalMinor),
        currency: a.currency,
        status: 'pending' as const,
      })),
    )
  }

  // ── 4. Mark the period closed ─────────────────────────────────────
  await db
    .update(payoutPeriods)
    .set({ status: 'closed', closedAt: new Date() })
    .where(eq(payoutPeriods.id, periodRow.id))

  // ── 5. Event + cache busts ───────────────────────────────────────
  const grandTotal = insertable.reduce(
    (acc, a) => acc + Number(a.totalMinor),
    0,
  )
  const byCurrencyMap = new Map<string, { userCount: number; totalMinor: number }>()
  for (const a of insertable) {
    const cur = byCurrencyMap.get(a.currency) ?? { userCount: 0, totalMinor: 0 }
    cur.userCount += 1
    cur.totalMinor += Number(a.totalMinor)
    byCurrencyMap.set(a.currency, cur)
  }
  const byCurrency = [...byCurrencyMap.entries()].map(([currency, v]) => ({
    currency,
    ...v,
  }))

  await db.insert(events).values({
    type: 'payout_period.closed',
    workspaceId: parsed.workspaceId,
    actorId: null,
    payload: {
      payoutPeriodId: periodRow.id,
      payoutCount: insertable.length,
      grandTotalMinor: grandTotal,
      byCurrency,
    },
  })

  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}/billing`)
    revalidatePath(`/my/earnings`)
  } catch {
    /* outside request context */
  }

  return {
    ok: true,
    payoutPeriodId: periodRow.id,
    payoutCount: insertable.length,
    grandTotalMinorAcrossCurrencies: grandTotal,
    byCurrency,
  }
}
