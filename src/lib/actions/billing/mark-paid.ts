'use server'

/**
 * Admin marks a payout as paid → ledger lands.
 *
 * Inputs:
 *   - payoutId  : the row to mark
 *   - externalRef: optional payment-provider receipt (Stripe id / chain tx / wire ref)
 *   - paymentMethodId: optional method that was actually used (for audit)
 *
 * Effects:
 *   1. Flip payouts.status='pending' → 'paid', stamp paid_at
 *   2. Insert a transactions row of type='earn', positive amount
 *   3. Rebuild wallet_balance for (user, workspace, currency)
 *   4. If this was the LAST pending payout in the period, flip the
 *      period to status='paid' too
 *   5. Emit event
 *
 * NO real payment-provider integration. The action assumes the admin
 * confirms out-of-band that money moved; we record the fact.
 *
 * Reverse action (`reversePayout`) wraps this so a clawback writes a
 * negative transaction without deleting the audit trail.
 */

import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import {
  events,
  payoutPeriods,
  payouts,
  transactions,
  walletBalance,
} from '@/lib/db/schema'
import { AppError, ConflictError, NotFoundError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'

/**
 * A db handle OR an open transaction — both expose select/insert/update with
 * identical signatures (drizzle's PgTransaction extends the same base), so
 * money helpers can run either standalone or inside a caller's transaction.
 * Structural Pick keeps this fully typed (no `any`).
 */
type WalletExecutor = Pick<
  ReturnType<typeof getDb>,
  'select' | 'insert' | 'update'
>

const inputSchema = z.object({
  payoutId: uuidLike,
  externalRef: z.string().max(200).optional(),
  paymentMethodId: uuidLike.optional(),
})

export interface MarkPaidResult {
  ok: true
  payoutId: string
  transactionId: string
  newWalletBalanceMinor: number
  periodAlsoClosed: boolean
}

export async function markPayoutPaid(
  input: z.infer<typeof inputSchema>,
): Promise<MarkPaidResult> {
  const parsed = inputSchema.parse(input)
  const db = getDb()

  const [payout] = await db
    .select()
    .from(payouts)
    .where(eq(payouts.id, parsed.payoutId))
    .limit(1)
  if (!payout) throw new NotFoundError('Payout')

  if (payout.status === 'paid') {
    throw new AppError(
      'ALREADY_PAID',
      `Payout ${payout.id} is already paid (at ${payout.paidAt?.toISOString() ?? 'unknown'}).`,
      400,
    )
  }
  if (payout.status === 'reversed') {
    throw new AppError(
      'PAYOUT_REVERSED',
      `Payout ${payout.id} was reversed; cannot mark paid.`,
      400,
    )
  }

  const [periodRow] = await db
    .select({ workspaceId: payoutPeriods.workspaceId })
    .from(payoutPeriods)
    .where(eq(payoutPeriods.id, payout.payoutPeriodId))
    .limit(1)
  if (!periodRow) throw new NotFoundError('Payout period')

  // Marking paid is admin-only. Authorize against the workspace we just
  // resolved (admin-of-A can't mark a payout in workspace B).
  const { user: actor } = await requireWorkspaceAdmin(periodRow.workspaceId)

  // ── 1–5. Flip → ledger → wallet → period → audit, ATOMICALLY ──────
  // One transaction + a status-CAS so a mid-action crash can't strand the
  // payout as 'paid' without its 'earn' ledger row (which the ALREADY_PAID
  // guard above would then make permanently unsettleable), and two concurrent
  // mark-paid calls can't both write an 'earn' row. Mirrors close-period.ts.
  const { txnId, newBalance, periodAlsoClosed } = await db.transaction(
    async (tx) => {
      // 1. Conditional flip — only if still in the status we observed.
      const flipped = await tx
        .update(payouts)
        .set({
          status: 'paid',
          paidAt: new Date(),
          externalRef: parsed.externalRef ?? null,
          paymentMethodId:
            parsed.paymentMethodId ?? payout.paymentMethodId ?? null,
        })
        .where(
          and(eq(payouts.id, payout.id), eq(payouts.status, payout.status)),
        )
        .returning({ id: payouts.id })
      if (flipped.length === 0) {
        throw new ConflictError(
          `Payout ${payout.id} was modified concurrently — not paying it twice.`,
        )
      }

      // 2. Append 'earn' transaction.
      const [txn] = await tx
        .insert(transactions)
        .values({
          userId: payout.userId,
          type: 'earn',
          amountMinor: payout.amountMinor, // positive — annotator earned this
          currency: payout.currency,
          workspaceId: periodRow.workspaceId,
          refTable: 'payouts',
          refId: payout.id,
          memo: `Payout from period ${payout.payoutPeriodId.slice(0, 8)}…`,
        })
        .returning({ id: transactions.id })

      // 3. Rebuild wallet for (user × workspace × currency) — inside the tx.
      const newBalance = await rebuildWallet(
        {
          userId: payout.userId,
          workspaceId: periodRow.workspaceId,
          currency: payout.currency,
        },
        tx,
      )

      // 4. Period also paid?
      const [{ remaining }] = await tx
        .select({
          remaining: sql<number>`count(*) filter (where status != 'paid' and status != 'reversed')::int`,
        })
        .from(payouts)
        .where(eq(payouts.payoutPeriodId, payout.payoutPeriodId))
      const periodAlsoClosed = Number(remaining) === 0
      if (periodAlsoClosed) {
        await tx
          .update(payoutPeriods)
          .set({ status: 'paid', paidAt: new Date() })
          .where(eq(payoutPeriods.id, payout.payoutPeriodId))
      }

      // 5. Audit event (in the tx so it lands iff the settlement commits).
      await tx.insert(events).values({
        type: 'payout.paid',
        workspaceId: periodRow.workspaceId,
        actorId: actor.id,
        payload: {
          payoutId: payout.id,
          transactionId: txn.id,
          amountMinor: payout.amountMinor,
          currency: payout.currency,
          externalRef: parsed.externalRef ?? null,
          periodAlsoClosed,
        },
      })

      return { txnId: txn.id, newBalance, periodAlsoClosed }
    },
  )

  try {
    revalidatePath(`/workspaces/${periodRow.workspaceId}/billing`)
    revalidatePath(`/my/earnings`)
  } catch {
    /* outside request context */
  }

  return {
    ok: true,
    payoutId: payout.id,
    transactionId: txnId,
    newWalletBalanceMinor: newBalance,
    periodAlsoClosed,
  }
}

// ─── Wallet rebuild helper ──────────────────────────────────────────────

/**
 * Re-derive a single wallet row by summing the user's transactions for
 * the (workspace × currency) slice. Cheap because we have indexed scans
 * on (user_id, ts). Upserts the wallet_balance row.
 */
export async function rebuildWallet(
  opts: {
    userId: string
    workspaceId: string
    currency: string
  },
  /** Run inside a caller's transaction when provided; else standalone. */
  executor?: WalletExecutor,
): Promise<number> {
  const db = executor ?? getDb()
  const [{ balance }] = await db
    .select({
      balance: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)::int`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, opts.userId),
        eq(transactions.workspaceId, opts.workspaceId),
        eq(transactions.currency, opts.currency),
      ),
    )

  const balanceMinor = Number(balance)

  // Upsert by (user, workspace, currency).
  const [existing] = await db
    .select({ id: walletBalance.id })
    .from(walletBalance)
    .where(
      and(
        eq(walletBalance.userId, opts.userId),
        eq(walletBalance.workspaceId, opts.workspaceId),
        eq(walletBalance.currency, opts.currency),
      ),
    )
    .limit(1)

  if (existing) {
    await db
      .update(walletBalance)
      .set({ balanceMinor, lastSettledAt: new Date() })
      .where(eq(walletBalance.id, existing.id))
  } else {
    await db
      .insert(walletBalance)
      .values({
        userId: opts.userId,
        workspaceId: opts.workspaceId,
        currency: opts.currency,
        balanceMinor,
        lastSettledAt: new Date(),
      })
  }

  return balanceMinor
}
