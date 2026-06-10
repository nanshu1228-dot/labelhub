import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Money-write atomicity + concurrency hardening (WS1 fixes A/B/D).
 *
 * markPayoutPaid, reviewWithdrawal(approve) and adminCreditAccount each used to
 * perform several independent db.* writes with no transaction (and no
 * status-CAS), so a mid-action crash could strand money / orphan an audit
 * event, and a concurrent/duplicate call could double-debit or double-credit.
 * These pin the fixes:
 *   - the writes now happen INSIDE one db.transaction;
 *   - the status flip is a conditional CAS — a 0-row flip rolls the tx back
 *     with ConflictError so a second concurrent call can't write money twice.
 */

vi.mock('@/lib/db/client', () => ({ getDb: vi.fn() }))
vi.mock('@/lib/auth/guards', () => ({
  requireWorkspaceAdmin: vi.fn(async () => ({
    user: { id: 'admin-1', email: 'admin@example.com' },
  })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notifications/emit', () => ({
  emitNotification: vi.fn().mockResolvedValue(undefined),
}))

import { markPayoutPaid } from '../mark-paid'
import { reviewWithdrawal } from '../review-withdrawal'
import { adminCreditAccount } from '../admin-credit'
import { getDb } from '@/lib/db/client'
import { AppError, ConflictError } from '@/lib/errors'

const WS = '11111111-1111-4111-8111-111111111111'
const PAYOUT = '22222222-2222-4222-8222-222222222222'
const PERIOD = '33333333-3333-4333-8333-333333333333'
const REQ = '44444444-4444-4444-8444-444444444444'
const USER = '55555555-5555-4555-8555-555555555555'

/**
 * Builds a transaction handle whose select() pulls from `selectQueue` in call
 * order, update().…returning() yields `flipRows`, and insert().…returning()
 * yields an id. Plain awaits (no .returning()) resolve undefined. Captures all
 * inserts/updates for assertions.
 */
function makeTx(opts: {
  selectQueue?: unknown[][]
  flipRows?: Array<{ id: string }>
  insertReturning?: Array<{ id: string }>
}) {
  let selIdx = 0
  const inserts: Array<{ table: unknown; rows: unknown }> = []
  const tx = {
    select: () => {
      const settle = () => Promise.resolve(opts.selectQueue?.[selIdx++] ?? [])
      const c: Record<string, unknown> = {}
      for (const k of ['from', 'where', 'groupBy']) c[k] = () => c
      c.limit = () => settle()
      c.then = (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
        settle().then(res, rej)
      return c
    },
    insert: (table: unknown) => ({
      values: (rows: unknown) => {
        inserts.push({ table, rows })
        const settled = Promise.resolve(opts.insertReturning ?? [{ id: 'gen-1' }])
        return Object.assign(Promise.resolve(undefined), {
          returning: () => settled,
        })
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const settled = Promise.resolve(opts.flipRows ?? [{ id: 'row-1' }])
          return Object.assign(Promise.resolve(undefined), {
            returning: () => settled,
          })
        },
      }),
    }),
  }
  return { tx, inserts }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('markPayoutPaid — atomic settlement + CAS', () => {
  function mount(opts: {
    payoutStatus?: string
    flipRows?: Array<{ id: string }>
  }) {
    const outerSelect = [
      [
        {
          id: PAYOUT,
          status: opts.payoutStatus ?? 'pending',
          userId: USER,
          amountMinor: 500,
          currency: 'CNY',
          payoutPeriodId: PERIOD,
          paymentMethodId: null,
        },
      ],
      [{ workspaceId: WS }],
    ]
    let outerIdx = 0
    const { tx } = makeTx({
      // rebuild-sum, rebuild-existing-wallet, period-remaining
      selectQueue: [[{ balance: 500 }], [{ id: 'w1' }], [{ remaining: 0 }]],
      flipRows: opts.flipRows,
      insertReturning: [{ id: 'txn-1' }],
    })
    const transaction = vi.fn(async (cb: (t: unknown) => unknown) => cb(tx))
    vi.mocked(getDb).mockReturnValue({
      select: () => {
        const rows = outerSelect[outerIdx++] ?? []
        const c: Record<string, unknown> = { from: () => c, where: () => c }
        c.limit = () => Promise.resolve(rows)
        return c
      },
      transaction,
    } as never)
    return { transaction }
  }

  it('runs the settlement inside one transaction and returns the txn id', async () => {
    const { transaction } = mount({ flipRows: [{ id: PAYOUT }] })
    const res = await markPayoutPaid({ payoutId: PAYOUT })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(res.ok).toBe(true)
    expect(res.transactionId).toBe('txn-1')
    expect(res.periodAlsoClosed).toBe(true)
  })

  it('throws ConflictError when the payout flip CAS affects 0 rows', async () => {
    mount({ flipRows: [] }) // a concurrent mark-paid already flipped it
    await expect(markPayoutPaid({ payoutId: PAYOUT })).rejects.toBeInstanceOf(
      ConflictError,
    )
  })

  it('rejects an already-paid payout before opening a transaction', async () => {
    const { transaction } = mount({ payoutStatus: 'paid' })
    await expect(markPayoutPaid({ payoutId: PAYOUT })).rejects.toBeInstanceOf(
      AppError,
    )
    expect(transaction).not.toHaveBeenCalled()
  })
})

describe('reviewWithdrawal(approve) — atomic debit + CAS', () => {
  function mount(opts: {
    balanceMinor?: number
    flipRows?: Array<{ id: string }>
  }) {
    const { tx } = makeTx({
      // wallet-balance-check, rebuild-sum, rebuild-existing-wallet
      selectQueue: [
        [{ balanceMinor: opts.balanceMinor ?? 100_000 }],
        [{ balance: 99_500 }],
        [{ id: 'w1' }],
      ],
      flipRows: opts.flipRows,
      insertReturning: [{ id: 'txn-1' }],
    })
    const transaction = vi.fn(async (cb: (t: unknown) => unknown) => cb(tx))
    vi.mocked(getDb).mockReturnValue({
      select: () => {
        const c: Record<string, unknown> = { from: () => c, where: () => c }
        c.limit = () =>
          Promise.resolve([
            { id: REQ, status: 'requested', userId: USER, amountMinor: 500, currency: 'CNY', workspaceId: WS },
          ])
        return c
      },
      transaction,
    } as never)
    return { transaction }
  }

  it('debits + flips inside one transaction on a healthy approve', async () => {
    const { transaction } = mount({ flipRows: [{ id: REQ }] })
    const res = await reviewWithdrawal({ requestId: REQ, decision: 'approve' })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(res.status).toBe('approved')
    expect(res.transactionId).toBe('txn-1')
  })

  it('throws ConflictError when the status CAS affects 0 rows (concurrent approve)', async () => {
    mount({ flipRows: [] })
    await expect(
      reviewWithdrawal({ requestId: REQ, decision: 'approve' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('throws on insufficient balance without flipping', async () => {
    mount({ balanceMinor: 100 }) // < amountMinor 500
    await expect(
      reviewWithdrawal({ requestId: REQ, decision: 'approve' }),
    ).rejects.toBeInstanceOf(AppError)
  })
})

describe('adminCreditAccount — atomic credit', () => {
  it('writes ledger + wallet + audit event inside one transaction', async () => {
    const { tx, inserts } = makeTx({
      // rebuild-sum, rebuild-existing-wallet
      selectQueue: [[{ balance: 500 }], [{ id: 'w1' }]],
      insertReturning: [{ id: 'txn-1' }],
    })
    const transaction = vi.fn(async (cb: (t: unknown) => unknown) => cb(tx))
    vi.mocked(getDb).mockReturnValue({
      // outer: the workspace-membership check
      select: () => {
        const c: Record<string, unknown> = { from: () => c, where: () => c }
        c.limit = () => Promise.resolve([{ userId: USER }])
        return c
      },
      transaction,
    } as never)
    const res = await adminCreditAccount({
      workspaceId: WS,
      userId: USER,
      amountMinor: 500,
      currency: 'CNY',
    })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(res.ok).toBe(true)
    expect(res.transactionId).toBe('txn-1')
    // The 'wallet.credited' audit event is one of the in-tx inserts.
    expect(
      inserts.some(
        (i) => (i.rows as { type?: string }).type === 'wallet.credited',
      ),
    ).toBe(true)
  })
})
