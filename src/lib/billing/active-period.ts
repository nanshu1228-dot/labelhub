import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { payoutPeriods } from '@/lib/db/schema'

/**
 * Active payout-period resolver.
 *
 * Every workspace has AT MOST one open period at a time (enforced by the
 * partial unique index `payout_periods_ws_open_uniq`). New line_items
 * always land in that period.
 *
 * If no open period exists when an approval fires, we lazily create one
 * starting "now" — the period boundary itself is admin-driven (manual
 * `close-period` action), so the start time is just "first activity in
 * this period". The `period_end` is initially set to start + 30 days as
 * a reasonable upper-bound; admins close earlier when they want to
 * batch payouts.
 *
 * This is server-only because it touches the DB. The pure pricing engine
 * (calculate-payout.ts) is the unit-test-friendly half.
 */

const DEFAULT_PERIOD_LENGTH_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface ActivePeriod {
  id: string
  workspaceId: string
  periodStart: Date
  periodEnd: Date
  status: 'open' | 'closed' | 'paid'
  closedAt: Date | null
  paidAt: Date | null
}

export async function ensureActivePeriod(
  workspaceId: string,
): Promise<ActivePeriod> {
  const db = getDb()

  // Most common path: an open period already exists.
  const [existing] = await db
    .select()
    .from(payoutPeriods)
    .where(
      and(
        eq(payoutPeriods.workspaceId, workspaceId),
        eq(payoutPeriods.status, 'open'),
      ),
    )
    .limit(1)
  if (existing) return rowToActive(existing)

  // Cold start: create one.
  // We don't synchronize this across requests — the partial-unique index
  // catches double-creates and the SECOND insert fails with a uniqueness
  // violation; the caller can retry the ensure() and pick up the winner.
  const now = new Date()
  const end = new Date(now.getTime() + DEFAULT_PERIOD_LENGTH_MS)

  try {
    const [created] = await db
      .insert(payoutPeriods)
      .values({
        workspaceId,
        periodStart: now,
        periodEnd: end,
        status: 'open',
      })
      .returning()
    return rowToActive(created)
  } catch (e) {
    // Race-loser path: another caller created it first. Re-read.
    const [retry] = await db
      .select()
      .from(payoutPeriods)
      .where(
        and(
          eq(payoutPeriods.workspaceId, workspaceId),
          eq(payoutPeriods.status, 'open'),
        ),
      )
      .limit(1)
    if (retry) return rowToActive(retry)
    throw e
  }
}

function rowToActive(row: typeof payoutPeriods.$inferSelect): ActivePeriod {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: row.status as ActivePeriod['status'],
    closedAt: row.closedAt,
    paidAt: row.paidAt,
  }
}
