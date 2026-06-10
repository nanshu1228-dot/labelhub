import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * approveAnnotation turns approved work into a payout line item. This pins the
 * money-path safety added in the transaction batch: the line-item upsert and
 * its `payout_line_item.*` audit event happen INSIDE one db.transaction, and
 * the guard rails (must be submitted; submitter not suspended) fire BEFORE any
 * write. (No direct test existed before — this also closes that coverage gap.)
 */

vi.mock('@/lib/db/client', () => ({ getDb: vi.fn() }))
vi.mock('@/lib/auth/guards', () => ({
  requireWorkspaceAdmin: vi.fn(async () => ({ user: { id: 'admin-1' } })),
}))
vi.mock('@/lib/actions/trust-status', () => ({
  readTrustStatus: vi.fn(async () => 'active'),
}))
vi.mock('@/lib/billing/active-period', () => ({
  ensureActivePeriod: vi.fn(async () => ({ id: 'period-1' })),
}))
vi.mock('@/lib/billing/calculate-payout', () => ({
  calculatePayoutLineItem: vi.fn(() => ({
    economyType: 'cash-per-item',
    currency: 'CNY',
    baseAmountMinor: 100,
    qualityMultiplierBp: 8000,
    bonusAmountMinor: 0,
    penaltyAmountMinor: 0,
    totalAmountMinor: 80,
    difficultyMultiplierBp: 10000,
    isBillable: true,
  })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { approveAnnotation } from '../approve-annotation'
import { getDb } from '@/lib/db/client'
import { readTrustStatus } from '@/lib/actions/trust-status'
import { AppError } from '@/lib/errors'

const WS = '11111111-1111-4111-8111-111111111111'
const ANN = '22222222-2222-4222-8222-222222222222'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const k of ['from', 'where', 'set']) c[k] = () => c
  c.limit = () => Promise.resolve(result)
  c.returning = () => Promise.resolve(result)
  return c
}

/**
 * Build the getDb mock. `selectQueue` feeds the pre-transaction reads in order
 * (annotation → topic → task → trust). The transaction's tx captures inserts.
 */
function setup(opts: { submittedAt?: Date | null } = {}) {
  const submittedAt = opts.submittedAt === undefined ? new Date() : opts.submittedAt
  const selectQueue: unknown[][] = [
    [{ id: ANN, userId: 'u1', topicId: 't-1', submittedAt }],
    [{ taskId: 'task-1', difficulty: null }],
    [
      {
        id: 'task-1',
        workspaceId: WS,
        templateMode: 'survey',
        rewardConfig: { type: 'cash-per-item', currency: 'CNY', baseAmountMinor: 100 },
      },
    ],
    [{ score: 0.8 }],
  ]
  let i = 0
  const inserts: Array<{ table: unknown; rows: unknown }> = []
  const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => {
    const tx = {
      select: () => chain([]), // no existing line → insert path
      update: () => chain([]),
      insert: (table: unknown) => ({
        values: (rows: unknown) => {
          inserts.push({ table, rows })
          const result = [{ id: 'line-1' }]
          return {
            returning: () => Promise.resolve(result),
            then: (onF: (v: unknown) => unknown) =>
              Promise.resolve(undefined).then(onF),
          }
        },
      }),
    }
    return cb(tx)
  })
  vi.mocked(getDb).mockReturnValue({
    select: () => chain(selectQueue[i++] ?? []),
    transaction,
  } as never)
  return { inserts, transaction }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('approveAnnotation', () => {
  it('creates the payout line + audit event inside one transaction', async () => {
    const { inserts, transaction } = setup()
    const res = await approveAnnotation({ annotationId: ANN })
    expect(res.ok).toBe(true)
    expect(res.created).toBe(true)
    expect(res.payoutLineItemId).toBe('line-1')
    expect(res.payoutPeriodId).toBe('period-1')
    expect(transaction).toHaveBeenCalledTimes(1)
    // The line-item insert carried the priced total, and an audit event followed.
    const lineInsert = inserts[0]?.rows as { totalAmountMinor: number }
    expect(lineInsert.totalAmountMinor).toBe(80)
    const eventInsert = inserts[1]?.rows as { type: string }
    expect(eventInsert.type).toBe('payout_line_item.created')
  })

  it('refuses (no transaction) when the annotation is not submitted', async () => {
    const { transaction } = setup({ submittedAt: null })
    await expect(approveAnnotation({ annotationId: ANN })).rejects.toBeInstanceOf(
      AppError,
    )
    expect(transaction).not.toHaveBeenCalled()
  })

  it('refuses (no transaction) when the submitter is suspended', async () => {
    const { transaction } = setup()
    vi.mocked(readTrustStatus).mockResolvedValueOnce('suspended')
    await expect(approveAnnotation({ annotationId: ANN })).rejects.toBeInstanceOf(
      AppError,
    )
    expect(transaction).not.toHaveBeenCalled()
  })
})
