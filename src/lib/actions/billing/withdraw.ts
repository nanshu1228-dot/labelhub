'use server'

/**
 * Annotator → withdraw REQUEST.
 *
 * A withdrawal is a request that an admin approves — not an instant
 * self-debit. This action:
 *
 *   1. Checks the wallet balance ≥ amount requested
 *   2. Checks amount ≥ withdrawal threshold (anti-dust)
 *   3. (Optional) binds a payment method, if one was chosen
 *   4. Inserts a `withdrawal_requests` row in status='requested'
 *   5. Emits 'wallet.withdraw_requested'
 *
 * The wallet balance is NOT touched here — it only drops when an admin
 * approves (see reviewWithdrawal), which keeps the ledger honest (a rejected
 * request never produces a transaction). No real payment rail is involved.
 *
 * Currency is required because a user can hold separate CNY / USDT balances
 * in the same workspace.
 */

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import {
  events,
  paymentMethods,
  walletBalance,
  withdrawalRequests,
} from '@/lib/db/schema'
import { AppError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { requireWorkspaceMember } from '@/lib/auth/guards'

// Minimum withdrawal — prevents dust-attack transfers.
const MIN_WITHDRAW_MINOR = 1000 // 10 CNY / 10 USDT

// Maximum withdrawal per request — caps a single payout request so a runaway
// or fat-fingered amount can't be filed in one shot. Larger payouts must be
// split into multiple requests (and reviewed individually).
const MAX_WITHDRAW_MINOR = 10_000_000 // 100,000 CNY / 100,000 USDT

const inputSchema = z.object({
  workspaceId: uuidLike,
  /** Optional payout destination — the simple credit→withdraw loop doesn't require one. */
  paymentMethodId: uuidLike.optional(),
  amountMinor: z.number().int().positive(),
  currency: z.string().min(3).max(8),
})

export interface RequestWithdrawResult {
  ok: true
  withdrawalRequestId: string
  status: 'requested'
  amountMinor: number
  currency: string
}

export async function requestWithdraw(
  input: z.infer<typeof inputSchema>,
): Promise<RequestWithdrawResult> {
  const parsed = inputSchema.parse(input)
  // Withdrawing is annotator-self (or admin-self). Viewers are read-only
  // collaborators and can't receive payouts. requireWorkspaceMember both
  // authenticates and binds the user to this workspace.
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

  if (parsed.amountMinor > MAX_WITHDRAW_MINOR) {
    throw new AppError(
      'ABOVE_MAX_WITHDRAW',
      `Maximum withdraw per request is ${MAX_WITHDRAW_MINOR / 100} ${parsed.currency}; you tried ${parsed.amountMinor / 100}. Split it into smaller requests.`,
      400,
    )
  }

  // If a payment method was chosen, it must belong to the user. We no longer
  // require it to be verified — the demo loop is frictionless (see the
  // payment-method fork). When none is chosen, the request carries no method.
  let paymentMethodId: string | null = null
  if (parsed.paymentMethodId) {
    const [pm] = await db
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.id, parsed.paymentMethodId),
          eq(paymentMethods.userId, userId),
        ),
      )
      .limit(1)
    if (!pm) throw new NotFoundError('Payment method')
    paymentMethodId = pm.id
  }

  // Balance must cover the request at filing time (re-checked again at approve).
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
      `Wallet has ${currentBalance / 100} ${parsed.currency}; cannot request a withdrawal of ${parsed.amountMinor / 100}.`,
      400,
    )
  }

  // Duplicate-in-flight guard: one pending request per (user, workspace,
  // currency). A withdrawal sits in 'requested' until an admin reviews it; a
  // second filing while one is still open would let the same balance be
  // claimed twice (the debit only lands at approve time). Block it.
  const [pending] = await db
    .select({ id: withdrawalRequests.id })
    .from(withdrawalRequests)
    .where(
      and(
        eq(withdrawalRequests.userId, userId),
        eq(withdrawalRequests.workspaceId, parsed.workspaceId),
        eq(withdrawalRequests.currency, parsed.currency),
        eq(withdrawalRequests.status, 'requested'),
      ),
    )
    .limit(1)
  if (pending) {
    throw new AppError(
      'PENDING_WITHDRAWAL_EXISTS',
      `You already have a pending ${parsed.currency} withdrawal awaiting review in this workspace; wait for it to be reviewed before filing another.`,
      409,
    )
  }

  const [req] = await db
    .insert(withdrawalRequests)
    .values({
      userId,
      workspaceId: parsed.workspaceId,
      amountMinor: parsed.amountMinor, // positive — the requested amount
      currency: parsed.currency,
      paymentMethodId,
      status: 'requested',
    })
    .returning({ id: withdrawalRequests.id })

  await db.insert(events).values({
    type: 'wallet.withdraw_requested',
    workspaceId: parsed.workspaceId,
    actorId: userId,
    payload: {
      withdrawalRequestId: req.id,
      paymentMethodId,
      amountMinor: parsed.amountMinor,
      currency: parsed.currency,
    },
  })

  try {
    revalidatePath('/my/earnings')
    revalidatePath(`/workspaces/${parsed.workspaceId}/billing`)
  } catch {
    /* outside request context */
  }

  return {
    ok: true,
    withdrawalRequestId: req.id,
    status: 'requested',
    amountMinor: parsed.amountMinor,
    currency: parsed.currency,
  }
}
