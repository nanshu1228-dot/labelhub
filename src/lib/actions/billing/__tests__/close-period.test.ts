import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * closePayoutPeriod is a money-path aggregation: it sums approved line items
 * into payouts and closes the period. This pins the safety properties added in
 * the transaction batch:
 *   - the create-payouts + close-period + audit writes happen INSIDE one
 *     db.transaction (so a crash can't leave a half-closed, double-payable
 *     period);
 *   - the period flip is a conditional CAS — if it affects 0 rows (a concurrent
 *     close already won) the whole tx rolls back with ConflictError;
 *   - an already-closed period is rejected up front and never opens a tx.
 */

vi.mock('@/lib/db/client', () => ({ getDb: vi.fn() }))
vi.mock('@/lib/auth/guards', () => ({
  requireWorkspaceAdmin: vi.fn(async () => ({ user: { id: 'admin-1' } })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { closePayoutPeriod } from '../close-period'
import { getDb } from '@/lib/db/client'
import { AppError, ConflictError } from '@/lib/errors'

const WS = '11111111-1111-4111-8111-111111111111'

/** A drizzle-ish chain whose terminal methods all resolve to `result`. */
function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const k of ['from', 'where', 'set', 'groupBy']) c[k] = () => c
  c.limit = () => Promise.resolve(result)
  c.groupBy = () => Promise.resolve(result)
  c.returning = () => Promise.resolve(result)
  c.values = () => Promise.resolve(undefined)
  return c
}

type Insert = { table: unknown; rows: unknown }

/**
 * Build the getDb mock. `period` is the row step-1 resolves; `aggregates` is
 * what the in-tx aggregate query returns; `flipRows` is what the conditional
 * close `.returning()` yields ([] = lost the CAS race). Captures payouts inserts.
 */
function setup(opts: {
  period: unknown
  aggregates?: unknown[]
  flipRows?: Array<{ id: string }>
}) {
  const inserts: Insert[] = []
  const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => {
    const tx = {
      select: () => chain(opts.aggregates ?? []),
      update: () => chain(opts.flipRows ?? [{ id: 'period-1' }]),
      insert: (table: unknown) => ({
        values: (rows: unknown) => {
          inserts.push({ table, rows })
          return Promise.resolve(undefined)
        },
      }),
    }
    return cb(tx)
  })
  vi.mocked(getDb).mockReturnValue({
    select: () => chain([opts.period]),
    transaction,
  } as never)
  return { inserts, transaction }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('closePayoutPeriod', () => {
  it('aggregates → inserts payouts → closes, all inside one transaction', async () => {
    const { inserts, transaction } = setup({
      period: { id: 'period-1', workspaceId: WS, status: 'open' },
      aggregates: [
        { userId: 'u1', currency: 'CNY', totalMinor: 300, lineCount: 2 },
      ],
    })
    const res = await closePayoutPeriod({ workspaceId: WS })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(res.payoutCount).toBe(1)
    expect(res.grandTotalMinorAcrossCurrencies).toBe(300)
    expect(res.byCurrency).toEqual([
      { currency: 'CNY', userCount: 1, totalMinor: 300 },
    ])
    // One payouts insert with the aggregated amount + one audit event insert.
    const payoutsInsert = inserts[0]?.rows as Array<{ amountMinor: number }>
    expect(payoutsInsert).toHaveLength(1)
    expect(payoutsInsert[0].amountMinor).toBe(300)
    expect(inserts).toHaveLength(2) // payouts + event
  })

  it('rejects an already-closed period before opening a transaction', async () => {
    const { transaction } = setup({
      period: { id: 'period-1', workspaceId: WS, status: 'closed' },
    })
    await expect(closePayoutPeriod({ workspaceId: WS })).rejects.toBeInstanceOf(
      AppError,
    )
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rolls back with ConflictError when the close CAS loses the race', async () => {
    const { inserts } = setup({
      period: { id: 'period-1', workspaceId: WS, status: 'open' },
      aggregates: [
        { userId: 'u1', currency: 'CNY', totalMinor: 300, lineCount: 2 },
      ],
      flipRows: [], // another close already flipped status='open' → 0 rows
    })
    await expect(closePayoutPeriod({ workspaceId: WS })).rejects.toBeInstanceOf(
      ConflictError,
    )
    // The payouts insert was attempted but the tx throws before commit; in a
    // real DB it rolls back. (We assert the guard fired, not the rollback.)
    expect(inserts.some((i) => Array.isArray(i.rows))).toBe(true)
  })

  it('skips $0 aggregates (no payouts row for zero totals)', async () => {
    const { inserts } = setup({
      period: { id: 'period-1', workspaceId: WS, status: 'open' },
      aggregates: [
        { userId: 'u1', currency: 'CNY', totalMinor: 0, lineCount: 1 },
      ],
    })
    const res = await closePayoutPeriod({ workspaceId: WS })
    expect(res.payoutCount).toBe(0)
    // Only the audit event is inserted; no payouts insert for a $0 aggregate.
    expect(inserts).toHaveLength(1)
  })
})
