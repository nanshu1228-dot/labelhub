'use server'

/**
 * Admin directly credits a workspace member's wallet.
 *
 * This is loop step 1 of the operable payment flow: an admin sets/credits a
 * given account with a withdrawable amount, and the user sees it immediately
 * on /my/earnings (which reads the rebuilt wallet_balance snapshot).
 *
 * Effect: append ONE positive `adjustment` transaction (the ledger is the
 * source of truth), then rebuild the wallet snapshot. No real payment rail —
 * this is the "money in" side of the no-real-money demo economy.
 */

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import {
  events,
  transactions,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema'
import { ForbiddenError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { emitNotification } from '@/lib/notifications/emit'
import { rebuildWallet } from './mark-paid'

const inputSchema = z.object({
  workspaceId: uuidLike,
  userId: uuidLike,
  /** Positive credit, MINOR units (fen / cents / 1e-6 USDT). */
  amountMinor: z.number().int().positive(),
  currency: z.string().min(3).max(8),
  memo: z.string().max(200).optional(),
})

export interface AdminCreditResult {
  ok: true
  transactionId: string
  newBalanceMinor: number
}

export async function adminCreditAccount(
  input: z.infer<typeof inputSchema>,
): Promise<AdminCreditResult> {
  const parsed = inputSchema.parse(input)
  // Admin-only, scoped to the workspace whose wallet we're crediting.
  const { user: actor } = await requireWorkspaceAdmin(parsed.workspaceId)
  const db = getDb()

  // The target must belong to THIS workspace — an admin of A cannot credit a
  // stranger into A's economy.
  const [member] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, parsed.workspaceId),
        eq(workspaceMembers.userId, parsed.userId),
      ),
    )
    .limit(1)
  let isMember = Boolean(member)
  if (!isMember) {
    // Legacy fallback: the workspace creator may predate the members row.
    const [ws] = await db
      .select({ adminId: workspaces.adminId })
      .from(workspaces)
      .where(eq(workspaces.id, parsed.workspaceId))
      .limit(1)
    isMember = ws?.adminId === parsed.userId
  }
  if (!isMember) {
    throw new ForbiddenError('Target user is not a member of this workspace.')
  }

  // Ledger row + wallet rebuild + audit event, atomically — so a crash can't
  // credit the wallet without leaving the matching 'wallet.credited' audit
  // event (or vice-versa). The ledger remains the source of truth; this just
  // closes the orphaned-audit-event gap. Mirrors approve-annotation.ts.
  const { txnId, newBalanceMinor } = await db.transaction(async (tx) => {
    const [txn] = await tx
      .insert(transactions)
      .values({
        userId: parsed.userId,
        type: 'adjustment',
        amountMinor: parsed.amountMinor, // positive — money enters the wallet
        currency: parsed.currency,
        workspaceId: parsed.workspaceId,
        refTable: 'admin_credit',
        memo: parsed.memo ?? `Admin credit by ${actor.email}`,
      })
      .returning({ id: transactions.id })

    const newBalanceMinor = await rebuildWallet(
      {
        userId: parsed.userId,
        workspaceId: parsed.workspaceId,
        currency: parsed.currency,
      },
      tx,
    )

    await tx.insert(events).values({
      type: 'wallet.credited',
      workspaceId: parsed.workspaceId,
      actorId: actor.id,
      payload: {
        transactionId: txn.id,
        targetUserId: parsed.userId,
        amountMinor: parsed.amountMinor,
        currency: parsed.currency,
        memo: parsed.memo ?? null,
      },
    })

    return { txnId: txn.id, newBalanceMinor }
  })

  // Best-effort inbox ping to the credited user (never fails the action).
  try {
    await emitNotification({
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      type: 'wallet.credited',
      title: 'Account credited',
      body: `${parsed.amountMinor / 100} ${parsed.currency} was added to your wallet.`,
      linkUrl: '/my/earnings',
      payload: {
        transactionId: txnId,
        amountMinor: parsed.amountMinor,
        currency: parsed.currency,
      },
      actorId: actor.id,
    })
  } catch {
    /* notifications are best-effort */
  }

  try {
    revalidatePath('/my/earnings')
    revalidatePath(`/workspaces/${parsed.workspaceId}/billing`)
  } catch {
    /* outside request context */
  }

  return { ok: true, transactionId: txnId, newBalanceMinor }
}
