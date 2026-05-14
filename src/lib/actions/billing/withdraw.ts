'use server'

/**
 * Annotator → withdraw request.
 *
 * Currently a simulated flow (no real payment-provider integration):
 *
 *   1. Check that wallet_balance ≥ amount requested
 *   2. Check that amount ≥ withdrawal threshold (anti-dust)
 *   3. Insert a transactions row of type='withdraw' with NEGATIVE amount
 *   4. Rebuild wallet_balance (now decreased)
 *   5. Return new balance + a synthetic "withdraw_id" the user can show admin
 *
 * Real flow would queue this against the chosen payment_method and the
 * admin or a worker would actually transfer money. For demo, the
 * transactions row is the receipt.
 *
 * Currency parameter is required because a user can have separate
 * CNY-wallet and USDT-wallet balances in the same workspace.
 */

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import {
  events,
  paymentMethods,
  transactions,
  walletBalance,
} from '@/lib/db/schema'
import { AppError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { requireWorkspaceMember } from '@/lib/auth/guards'
import { rebuildWallet } from './mark-paid'

// Minimum withdrawal — prevents dust-attack transfers and matches my
// design recommendation. Bumpable later via workspace settings.
const MIN_WITHDRAW_MINOR = 1000 // 10 CNY / 10 USDT

const inputSchema = z.object({
  workspaceId: uuidLike,
  paymentMethodId: uuidLike,
  amountMinor: z.number().int().positive(),
  currency: z.string().min(3).max(8),
})

export interface RequestWithdrawResult {
  ok: true
  transactionId: string
  newBalanceMinor: number
  paymentMethodId: string
  paymentMethodDestination: string
  /** Stub — would be the payment-provider's queue ref in production. */
  withdrawRef: string
}

export async function requestWithdraw(
  input: z.infer<typeof inputSchema>,
): Promise<RequestWithdrawResult> {
  const parsed = inputSchema.parse(input)
  // Withdrawing is annotator-self (or admin-self). Viewers can't receive
  // payouts — they're read-only collaborators. Use requireWorkspaceMember
  // so we both authenticate the user AND bind them to this workspace.
  const { user, role } = await requireWorkspaceMember(parsed.workspaceId)
  if (role === 'viewer') {
    throw new ForbiddenError(
      'Viewers cannot withdraw earnings from this workspace.',
    )
  }
  const userId = user.id
  const db = getDb()

  if (parsed.amountMinor < MIN_WITHDRAW_MINOR) {
    throw new AppError(
      'BELOW_MIN_WITHDRAW',
      `Minimum withdraw is ${MIN_WITHDRAW_MINOR / 100} ${parsed.currency}; you tried ${parsed.amountMinor / 100}.`,
      400,
    )
  }

  // Verify payment method belongs to user
  const [pm] = await db
    .select()
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.id, parsed.paymentMethodId),
        eq(paymentMethods.userId, userId),
      ),
    )
    .limit(1)
  if (!pm) throw new NotFoundError('Payment method')
  if (!pm.verifiedAt) {
    throw new ForbiddenError(
      'Payment method must be verified before it can receive a withdrawal.',
    )
  }

  // Check wallet balance
  const [wallet] = await db
    .select()
    .from(walletBalance)
    .where(
      and(
        eq(walletBalance.userId, userId),
        eq(walletBalance.workspaceId, parsed.workspaceId),
        eq(walletBalance.currency, parsed.currency),
      ),
    )
    .limit(1)
  const currentBalance = wallet?.balanceMinor ?? 0
  if (currentBalance < parsed.amountMinor) {
    throw new AppError(
      'INSUFFICIENT_BALANCE',
      `Wallet has ${currentBalance / 100} ${parsed.currency}; cannot withdraw ${parsed.amountMinor / 100}.`,
      400,
    )
  }

  // Insert negative-amount 'withdraw' transaction
  const withdrawRef = `wd-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`
  const [txn] = await db
    .insert(transactions)
    .values({
      userId,
      type: 'withdraw',
      amountMinor: -parsed.amountMinor, // negative — leaves the wallet
      currency: parsed.currency,
      workspaceId: parsed.workspaceId,
      refTable: 'payment_methods',
      refId: pm.id,
      memo: `Withdraw to ${pm.type}:${pm.destination.slice(0, 20)}… ref=${withdrawRef}`,
    })
    .returning({ id: transactions.id })

  const newBalance = await rebuildWallet({
    userId,
    workspaceId: parsed.workspaceId,
    currency: parsed.currency,
  })

  await db.insert(events).values({
    type: 'wallet.withdraw_requested',
    workspaceId: parsed.workspaceId,
    actorId: userId,
    payload: {
      transactionId: txn.id,
      paymentMethodId: pm.id,
      paymentMethodType: pm.type,
      amountMinor: parsed.amountMinor,
      currency: parsed.currency,
      withdrawRef,
      newBalanceMinor: newBalance,
    },
  })

  try {
    revalidatePath('/my/earnings')
  } catch {
    /* outside request context */
  }

  return {
    ok: true,
    transactionId: txn.id,
    newBalanceMinor: newBalance,
    paymentMethodId: pm.id,
    paymentMethodDestination: pm.destination,
    withdrawRef,
  }
}
