'use server'

/**
 * Admin reviews a withdrawal request — the "money out" side of the operable
 * payment flow (loop step 4).
 *
 *   reviewWithdrawal(approve) → re-check balance, append a NEGATIVE 'withdraw'
 *       transaction (the debit lands here, not at request time), rebuild the
 *       wallet, flip status 'requested' → 'approved'.
 *   reviewWithdrawal(reject)  → flip to 'rejected' with a memo; NO ledger row,
 *       so the balance is never touched.
 *   markWithdrawalPaid        → flip 'approved' → 'paid', stamp a synthetic
 *       receipt. No real payment rail; operational marker only (mirrors
 *       markPayoutPaid's no-rail contract).
 *
 * All three are workspace-admin only — the workspace is resolved from the
 * request row first, then guarded (admin-of-A cannot touch a request in B).
 */

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import {
  events,
  transactions,
  walletBalance,
  withdrawalRequests,
} from '@/lib/db/schema'
import { AppError, ConflictError, NotFoundError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { emitNotification } from '@/lib/notifications/emit'
import { rebuildWallet } from './mark-paid'

const reviewSchema = z.object({
  requestId: uuidLike,
  decision: z.enum(['approve', 'reject']),
  memo: z.string().max(200).optional(),
})

export async function reviewWithdrawal(input: z.infer<typeof reviewSchema>) {
  const parsed = reviewSchema.parse(input)
  const db = getDb()

  const [req] = await db
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.id, parsed.requestId))
    .limit(1)
  if (!req) throw new NotFoundError('Withdrawal request')

  // Resolve workspace from the row, THEN authorize.
  const { user: actor } = await requireWorkspaceAdmin(req.workspaceId)

  if (req.status !== 'requested') {
    throw new AppError(
      'ALREADY_REVIEWED',
      `Withdrawal ${req.id} is already ${req.status}; only a 'requested' withdrawal can be reviewed.`,
      400,
    )
  }

  // ── Reject: no ledger row, balance untouched ─────────────────────────
  if (parsed.decision === 'reject') {
    await db
      .update(withdrawalRequests)
      .set({
        status: 'rejected',
        decisionMemo: parsed.memo ?? null,
        reviewedByUserId: actor.id,
        reviewedAt: new Date(),
      })
      .where(eq(withdrawalRequests.id, req.id))

    await db.insert(events).values({
      type: 'withdrawal.rejected',
      workspaceId: req.workspaceId,
      actorId: actor.id,
      payload: {
        requestId: req.id,
        userId: req.userId,
        amountMinor: req.amountMinor,
        currency: req.currency,
        memo: parsed.memo ?? null,
      },
    })

    // Best-effort inbox ping to the affected user (never fails the action).
    try {
      await emitNotification({
        userId: req.userId,
        workspaceId: req.workspaceId,
        type: 'withdrawal.rejected',
        title: 'Withdrawal rejected',
        body: parsed.memo
          ? `Your withdrawal of ${req.amountMinor / 100} ${req.currency} was rejected: ${parsed.memo}`
          : `Your withdrawal of ${req.amountMinor / 100} ${req.currency} was rejected.`,
        linkUrl: '/my/earnings',
        payload: {
          requestId: req.id,
          amountMinor: req.amountMinor,
          currency: req.currency,
          memo: parsed.memo ?? null,
        },
        actorId: actor.id,
      })
    } catch {
      /* notifications are best-effort */
    }

    revalidateBilling(req.workspaceId)
    return { ok: true as const, status: 'rejected' as const }
  }

  // ── Approve: the debit lands now — ATOMICALLY ────────────────────────
  // Re-check balance, write the negative ledger row, rebuild the wallet, and
  // flip the status in ONE transaction with a status-CAS. A crash mid-way (or
  // a concurrent / duplicate approve) can't double-debit: the second approve
  // finds status != 'requested', the CAS affects 0 rows, and the whole tx —
  // including the debit it just wrote — rolls back. Mirrors close-period.ts.
  const { txnId, newBalanceMinor } = await db.transaction(async (tx) => {
    const [wallet] = await tx
      .select()
      .from(walletBalance)
      .where(
        and(
          eq(walletBalance.userId, req.userId),
          eq(walletBalance.workspaceId, req.workspaceId),
          eq(walletBalance.currency, req.currency),
        ),
      )
      .limit(1)
    const currentBalance = wallet?.balanceMinor ?? 0
    if (currentBalance < req.amountMinor) {
      throw new AppError(
        'INSUFFICIENT_BALANCE',
        `Wallet has ${currentBalance / 100} ${req.currency}; cannot approve a withdrawal of ${req.amountMinor / 100}.`,
        400,
      )
    }

    const [txn] = await tx
      .insert(transactions)
      .values({
        userId: req.userId,
        type: 'withdraw',
        amountMinor: -req.amountMinor, // negative — leaves the wallet
        currency: req.currency,
        workspaceId: req.workspaceId,
        refTable: 'withdrawal_requests',
        refId: req.id,
        memo: `Withdrawal approved by ${actor.email}`,
      })
      .returning({ id: transactions.id })

    const newBalanceMinor = await rebuildWallet(
      {
        userId: req.userId,
        workspaceId: req.workspaceId,
        currency: req.currency,
      },
      tx,
    )

    // Conditional flip — refuses (rolls the whole tx, incl. the debit, back)
    // if this request left 'requested' since we read it.
    const flipped = await tx
      .update(withdrawalRequests)
      .set({
        status: 'approved',
        txnId: txn.id,
        reviewedByUserId: actor.id,
        reviewedAt: new Date(),
        decisionMemo: parsed.memo ?? null,
      })
      .where(
        and(
          eq(withdrawalRequests.id, req.id),
          eq(withdrawalRequests.status, 'requested'),
        ),
      )
      .returning({ id: withdrawalRequests.id })
    if (flipped.length === 0) {
      throw new ConflictError(
        `Withdrawal ${req.id} was reviewed concurrently — not debiting twice.`,
      )
    }

    await tx.insert(events).values({
      type: 'withdrawal.approved',
      workspaceId: req.workspaceId,
      actorId: actor.id,
      payload: {
        requestId: req.id,
        transactionId: txn.id,
        userId: req.userId,
        amountMinor: req.amountMinor,
        currency: req.currency,
        newBalanceMinor,
      },
    })

    return { txnId: txn.id, newBalanceMinor }
  })

  // Best-effort inbox ping to the affected user (never fails the action).
  try {
    await emitNotification({
      userId: req.userId,
      workspaceId: req.workspaceId,
      type: 'withdrawal.approved',
      title: 'Withdrawal approved',
      body: `Your withdrawal of ${req.amountMinor / 100} ${req.currency} was approved.`,
      linkUrl: '/my/earnings',
      payload: {
        requestId: req.id,
        transactionId: txnId,
        amountMinor: req.amountMinor,
        currency: req.currency,
      },
      actorId: actor.id,
    })
  } catch {
    /* notifications are best-effort */
  }

  revalidateBilling(req.workspaceId)
  return {
    ok: true as const,
    status: 'approved' as const,
    transactionId: txnId,
    newBalanceMinor,
  }
}

const markPaidSchema = z.object({
  requestId: uuidLike,
  externalRef: z.string().max(200).optional(),
})

export async function markWithdrawalPaid(
  input: z.infer<typeof markPaidSchema>,
) {
  const parsed = markPaidSchema.parse(input)
  const db = getDb()

  const [req] = await db
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.id, parsed.requestId))
    .limit(1)
  if (!req) throw new NotFoundError('Withdrawal request')

  const { user: actor } = await requireWorkspaceAdmin(req.workspaceId)

  if (req.status === 'paid') {
    throw new AppError(
      'ALREADY_PAID',
      `Withdrawal ${req.id} is already marked paid.`,
      400,
    )
  }
  if (req.status !== 'approved') {
    throw new AppError(
      'NOT_APPROVED',
      `Withdrawal ${req.id} must be approved before it can be marked paid (currently ${req.status}).`,
      400,
    )
  }

  // Synthetic receipt — NO real payment rail is called.
  const ref = parsed.externalRef ?? `wd-${req.id.slice(0, 8)}`
  // Flip + audit atomically, CAS on 'approved' so a concurrent/duplicate
  // mark-paid can't double-stamp and the event can't orphan from the flip.
  await db.transaction(async (tx) => {
    const flipped = await tx
      .update(withdrawalRequests)
      .set({ status: 'paid', externalRef: ref })
      .where(
        and(
          eq(withdrawalRequests.id, req.id),
          eq(withdrawalRequests.status, 'approved'),
        ),
      )
      .returning({ id: withdrawalRequests.id })
    if (flipped.length === 0) {
      throw new ConflictError(
        `Withdrawal ${req.id} was modified concurrently — not marking paid twice.`,
      )
    }
    await tx.insert(events).values({
      type: 'withdrawal.paid',
      workspaceId: req.workspaceId,
      actorId: actor.id,
      payload: {
        requestId: req.id,
        userId: req.userId,
        amountMinor: req.amountMinor,
        currency: req.currency,
        externalRef: ref,
      },
    })
  })

  // Best-effort inbox ping to the affected user (never fails the action).
  try {
    await emitNotification({
      userId: req.userId,
      workspaceId: req.workspaceId,
      type: 'withdrawal.paid',
      title: 'Withdrawal paid',
      body: `Your withdrawal of ${req.amountMinor / 100} ${req.currency} has been paid out.`,
      linkUrl: '/my/earnings',
      payload: {
        requestId: req.id,
        amountMinor: req.amountMinor,
        currency: req.currency,
        externalRef: ref,
      },
      actorId: actor.id,
    })
  } catch {
    /* notifications are best-effort */
  }

  revalidateBilling(req.workspaceId)
  return { ok: true as const, status: 'paid' as const, externalRef: ref }
}

function revalidateBilling(workspaceId: string) {
  try {
    revalidatePath('/my/earnings')
    revalidatePath(`/workspaces/${workspaceId}/billing`)
  } catch {
    /* outside request context */
  }
}
