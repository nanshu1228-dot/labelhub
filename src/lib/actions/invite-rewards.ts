'use server'

/**
 * Admin moderation for invite-reward rows that landed in
 * `status='manual_review'` (or 'blocked' that admin wants to
 * reverse). Two outcomes:
 *
 *   reviewInviteReward({ rewardId, decision: 'approve' }) →
 *     flip to 'granted', post the transaction, bump wallet,
 *     emit notification + audit event.
 *
 *   reviewInviteReward({ rewardId, decision: 'deny' }) →
 *     flip to 'blocked', emit audit event. No money moves.
 *
 * Idempotency: re-calling on an already-resolved row is a no-op.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  events,
  inviteRewards,
  users,
} from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { uuidLike } from '@/lib/validators/uuid'
import {
  NotFoundError,
  ValidationError,
} from '@/lib/errors'
import { emitNotification } from '@/lib/notifications/emit'
import { creditInviterWalletTx } from '@/lib/billing/invite-rewards'

const reviewSchema = z.object({
  rewardId: uuidLike,
  decision: z.enum(['approve', 'deny']),
  /** Optional admin note — surfaced to the inviter via inbox + audit. */
  note: z.string().max(500).optional(),
})

export async function reviewInviteReward(
  input: z.infer<typeof reviewSchema>,
): Promise<{ ok: true; status: 'granted' | 'blocked' }> {
  const parsed = reviewSchema.parse(input)
  const db = getDb()

  // 1. Look up the row + verify the admin owns the workspace.
  const [row] = await db
    .select()
    .from(inviteRewards)
    .where(eq(inviteRewards.id, parsed.rewardId))
    .limit(1)
  if (!row) throw new NotFoundError('Invite reward')

  const { user } = await requireWorkspaceAdmin(row.workspaceId)

  // 2. Only manual_review / blocked rows are reviewable.
  //    granted = already final; refuse politely.
  if (row.status !== 'manual_review' && row.status !== 'blocked') {
    throw new ValidationError(
      `This reward is ${row.status} — only manual_review / blocked rows can be reviewed.`,
    )
  }

  // 3. If admin denies a manual_review or denies-again a blocked row,
  //    just flip status. No money moves.
  if (parsed.decision === 'deny') {
    if (row.status === 'blocked') {
      // No-op — already blocked.
      return { ok: true as const, status: 'blocked' }
    }
    await db
      .update(inviteRewards)
      .set({
        status: 'blocked',
        reviewedBy: user.id,
        blockReason: parsed.note ?? row.blockReason ?? 'Admin denied.',
      })
      .where(eq(inviteRewards.id, row.id))
    await db.insert(events).values({
      type: 'invite_reward.denied',
      workspaceId: row.workspaceId,
      actorId: user.id,
      payload: {
        rewardId: row.id,
        inviterUserId: row.inviterUserId,
        inviteeUserId: row.inviteeUserId,
        amountMinor: row.amountMinor,
        currency: row.currency,
        reason: parsed.note ?? null,
      },
    })
    revalidatePath(`/workspaces/${row.workspaceId}/members`)
    return { ok: true as const, status: 'blocked' }
  }

  // 4. Approve path — flip to granted, credit wallet, write audit event
  //    inside a single transaction so a partial failure can't leave the
  //    row 'granted' without a matching wallet credit (Phase-13 audit
  //    fix #1+#4).
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(inviteRewards)
      .set({
        status: 'granted',
        reviewedBy: user.id,
        grantedAt: now,
        blockReason: null,
      })
      .where(eq(inviteRewards.id, row.id))

    await creditInviterWalletTx({
      tx,
      inviterUserId: row.inviterUserId,
      workspaceId: row.workspaceId,
      amountMinor: row.amountMinor,
      currency: row.currency,
      refRewardId: row.id,
      memo: parsed.note
        ? `Invite reward (admin-approved): ${parsed.note.slice(0, 80)}`
        : 'Invite reward (admin-approved)',
    })

    await tx.insert(events).values({
      type: 'invite_reward.granted',
      workspaceId: row.workspaceId,
      actorId: user.id,
      payload: {
        rewardId: row.id,
        inviterUserId: row.inviterUserId,
        inviteeUserId: row.inviteeUserId,
        amountMinor: row.amountMinor,
        currency: row.currency,
        reason: parsed.note ?? null,
        via: 'admin_review',
      },
    })
  })

  // Out-of-transaction side effect: inbox notification (best-effort).
  const [invitee] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, row.inviteeUserId))
    .limit(1)
  await emitNotification({
    userId: row.inviterUserId,
    workspaceId: row.workspaceId,
    type: 'invite_reward.granted',
    title: `+¥${row.amountMinor / 100} invite reward approved`,
    body: invitee?.email
      ? `Admin approved your invite reward for ${invitee.email.split('@')[0]}.`
      : 'Admin approved your invite reward.',
    linkUrl: '/my/earnings',
    payload: {
      rewardId: row.id,
      amountMinor: row.amountMinor,
      currency: row.currency,
      reviewer: user.id,
    },
    actorId: user.id,
  }).catch(() => {
    // Notification glitch never blocks the credit.
  })

  revalidatePath(`/workspaces/${row.workspaceId}/members`)
  return { ok: true as const, status: 'granted' }
}
