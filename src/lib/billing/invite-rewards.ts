import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  events,
  inviteRewards,
  transactions,
  users,
  walletBalance,
  workspaceMembers,
} from '@/lib/db/schema'
import { emitNotification } from '@/lib/notifications/emit'

/**
 * Invite-reward automation (Phase-13).
 *
 * The contract: when an admin approves the Nth annotation by user A,
 * if A was originally invited into this workspace by user B, and the
 * threshold (default 5) is crossed by this approval, B earns a flat
 * cash credit (¥200 default) into their workspace wallet.
 *
 * The function below is the single entry point called from
 * `reviewAnnotation` after a successful approval. It is:
 *   - Idempotent — the (inviter, invitee, workspace) unique index
 *     guarantees a second call no-ops after the first.
 *   - Off the hot path — invoked inside `after()` in the approval
 *     action; the verdict commits regardless of reward outcome.
 *   - Safe-by-default — abuse rules push borderline cases to
 *     'manual_review' so a human admin gates them.
 *
 * Anti-abuse rules (pure, exported for unit tests):
 *   - inviter suspended       → status='blocked' (admin must intervene)
 *   - same email domain       → status='manual_review' (collusion check)
 *   - threshold crossed too
 *     fast after invitee joined → status='manual_review' (water-army check)
 *
 * Reward amount: read from the workspace's reward settings if present,
 * otherwise the platform default (¥200 = 20000 minor units).
 */

export const INVITE_REWARD_THRESHOLD = 5
export const INVITE_REWARD_DEFAULT_AMOUNT_MINOR = 20_000 // ¥200
export const INVITE_REWARD_DEFAULT_CURRENCY = 'CNY'
/** Anti-abuse: if the threshold is crossed in less than this many
 *  hours after the invitee joined, treat the burst as suspicious. */
export const INVITE_REWARD_FAST_THRESHOLD_HOURS = 24

export type AbuseDecision =
  | { kind: 'allow' }
  | { kind: 'manual_review'; reason: string }
  | { kind: 'block'; reason: string }

/**
 * Decide whether to auto-grant, send to manual review, or block —
 * pure function over the inputs so it's unit-testable without DB.
 */
export function decideInviteRewardAbuse(opts: {
  inviterEmail: string
  inviteeEmail: string
  inviterTrustStatus: string
  /** Hours between invitee.joined_at and the trigger annotation
   *  approval (timestamp of this check). */
  hoursSinceJoin: number
}): AbuseDecision {
  // Hard block: inviter is suspended → reward would credit a wallet
  // we're already restricting. Admin can override later by reviewing.
  if (opts.inviterTrustStatus === 'suspended') {
    return { kind: 'block', reason: 'Inviter is suspended.' }
  }

  // Soft check: same email domain — common pattern is colluding
  // co-workers / sock puppets sharing an org domain. Public providers
  // (gmail/qq/163/etc.) are too common to flag, so we whitelist them.
  const inviterDomain = opts.inviterEmail.toLowerCase().split('@')[1] ?? ''
  const inviteeDomain = opts.inviteeEmail.toLowerCase().split('@')[1] ?? ''
  const publicDomains = new Set([
    'gmail.com',
    'qq.com',
    '163.com',
    '126.com',
    'outlook.com',
    'hotmail.com',
    'yahoo.com',
    'icloud.com',
    'foxmail.com',
    'protonmail.com',
  ])
  if (
    inviterDomain &&
    inviterDomain === inviteeDomain &&
    !publicDomains.has(inviterDomain)
  ) {
    return {
      kind: 'manual_review',
      reason: `Inviter and invitee share the private domain "${inviterDomain}".`,
    }
  }

  // Soft check: threshold crossed unusually fast — could be a water-
  // army farming approvals. Admins eyeball these.
  if (opts.hoursSinceJoin < INVITE_REWARD_FAST_THRESHOLD_HOURS) {
    return {
      kind: 'manual_review',
      reason: `Invitee crossed ${INVITE_REWARD_THRESHOLD} approvals in ${Math.round(
        opts.hoursSinceJoin,
      )}h — flagged as suspiciously fast.`,
    }
  }

  return { kind: 'allow' }
}

/**
 * Tx-aware wallet credit: write a `transactions` row + upsert the
 * `wallet_balance` materialized snapshot inside the caller's open
 * drizzle transaction. Returns the transaction id.
 *
 * Caller is required to pass `tx` so the insert + upsert commit
 * atomically with the surrounding invite_rewards row write — the whole
 * "row + ledger + balance" must either all land or all roll back.
 * (Phase-13 audit fix #1 + #4: prior version made these three
 * statements as independent writes, leaving the door open for a
 * partial-commit window where a granted row had no wallet credit.)
 */
async function creditInviterWalletTx(opts: {
  tx: TxRunner
  inviterUserId: string
  workspaceId: string
  amountMinor: number
  currency: string
  refRewardId: string
  memo: string
}): Promise<string> {
  const [txn] = await opts.tx
    .insert(transactions)
    .values({
      userId: opts.inviterUserId,
      type: 'invite_reward',
      amountMinor: opts.amountMinor,
      currency: opts.currency,
      workspaceId: opts.workspaceId,
      refTable: 'invite_rewards',
      refId: opts.refRewardId,
      memo: opts.memo,
    })
    .returning({ id: transactions.id })

  await opts.tx.execute(sql`
    INSERT INTO wallet_balance ("user_id", "workspace_id", "currency", "balance_minor", "last_settled_at")
    VALUES (${opts.inviterUserId}, ${opts.workspaceId}, ${opts.currency}, ${opts.amountMinor}, now())
    ON CONFLICT ON CONSTRAINT wallet_balance_uniq
    DO UPDATE SET
      balance_minor = wallet_balance.balance_minor + EXCLUDED.balance_minor,
      last_settled_at = now()
  `)
  void walletBalance // keep schema import alive

  return txn.id
}

/**
 * Internal type alias for the drizzle transaction runner. Defined here
 * (instead of pulling from drizzle's deep typings) so the action layer
 * can share the same helper.
 */
type TxRunner = Parameters<
  Parameters<ReturnType<typeof getDb>['transaction']>[0]
>[0]
/** Re-exported for the action layer's reviewInviteReward path. */
export { creditInviterWalletTx }
export type { TxRunner }

/**
 * Main entry. Called from `reviewAnnotation` (inside `after()`) on
 * every successful annotation approval. Cheap when the trigger doesn't
 * fire — at most one COUNT + one membership read.
 *
 * Idempotency: the unique index on (inviter, invitee, workspace)
 * prevents a duplicate row from ever landing, so re-running this
 * after the first grant is safe. We also short-circuit on existing
 * rows to skip the COUNT.
 */
export async function scanInviteRewardOnApproval(opts: {
  inviteeUserId: string
  workspaceId: string
  triggerAnnotationId: string
}): Promise<void> {
  const db = getDb()

  // 1. Resolve the inviter (if any) via workspace_members.invited_by.
  //    No invitedBy → no reward path.
  const [member] = await db
    .select({
      invitedBy: workspaceMembers.invitedBy,
      joinedAt: workspaceMembers.joinedAt,
    })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, opts.inviteeUserId),
        eq(workspaceMembers.workspaceId, opts.workspaceId),
      ),
    )
    .limit(1)
  if (!member?.invitedBy) return

  const inviterUserId = member.invitedBy

  // Guard: an inviter never earns a reward off themselves. The DB
  // also rejects this via the unique constraint, but checking
  // upfront avoids a wasted COUNT.
  if (inviterUserId === opts.inviteeUserId) return

  // 2. Idempotency check — already processed?
  const [existing] = await db
    .select({ id: inviteRewards.id })
    .from(inviteRewards)
    .where(
      and(
        eq(inviteRewards.inviterUserId, inviterUserId),
        eq(inviteRewards.inviteeUserId, opts.inviteeUserId),
        eq(inviteRewards.workspaceId, opts.workspaceId),
      ),
    )
    .limit(1)
  if (existing) return

  // 3. Count approved annotations by this invitee in this workspace.
  //    Phase-13 audit fix #9: use COUNT(DISTINCT annotationId) so a
  //    duplicate annotation.approved event for the same annotation
  //    can't inflate the count. The reviewAnnotation path is the only
  //    writer today and it's status-gated, but DISTINCT keeps the
  //    threshold tamper-resistant against any future emit-path bug.
  const [tally] = await db
    .select({
      n: sql<number>`count(DISTINCT ${events.payload} ->> 'annotationId')::int`,
    })
    .from(events)
    .where(
      and(
        eq(events.type, 'annotation.approved'),
        eq(events.workspaceId, opts.workspaceId),
        sql`${events.payload} ->> 'submitterUserId' = ${opts.inviteeUserId}`,
      ),
    )
  const approvedCount = Number(tally?.n ?? 0)
  if (approvedCount < INVITE_REWARD_THRESHOLD) return

  // 4. Pull both users for the abuse check.
  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
    })
    .from(users)
    .where(sql`${users.id} = ANY(ARRAY[${inviterUserId}::uuid, ${opts.inviteeUserId}::uuid])`)
  const inviter = userRows.find((u) => u.id === inviterUserId)
  const invitee = userRows.find((u) => u.id === opts.inviteeUserId)
  if (!inviter || !invitee) return

  const [inviterMember] = await db
    .select({ trustStatus: workspaceMembers.trustStatus })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, inviterUserId),
        eq(workspaceMembers.workspaceId, opts.workspaceId),
      ),
    )
    .limit(1)

  const hoursSinceJoin =
    (Date.now() - new Date(member.joinedAt).getTime()) / (3600 * 1000)

  const decision = decideInviteRewardAbuse({
    inviterEmail: inviter.email,
    inviteeEmail: invitee.email,
    inviterTrustStatus: inviterMember?.trustStatus ?? 'active',
    hoursSinceJoin,
  })

  // 5. Decide row status + insert. If 'allow', we'll credit below.
  const status =
    decision.kind === 'allow'
      ? 'granted'
      : decision.kind === 'manual_review'
        ? 'manual_review'
        : 'blocked'
  const blockReason = decision.kind === 'allow' ? null : decision.reason

  const amountMinor = INVITE_REWARD_DEFAULT_AMOUNT_MINOR
  const currency = INVITE_REWARD_DEFAULT_CURRENCY
  const grantedAt = status === 'granted' ? new Date() : null

  // 5. Atomic write — Phase-13 audit fix #1+#4: insert the reward row,
  //    credit the wallet (only when status='granted'), and write the
  //    audit event inside ONE transaction. Either all four land or
  //    none do; no partial-commit window where a row is 'granted' but
  //    the wallet wasn't actually bumped.
  //
  //    onConflictDoNothing handles the race where two approvals fire
  //    simultaneously — the unique (inviter, invitee, workspace)
  //    index makes one winner. The loser bails out with no side
  //    effects because we short-circuit on inserted.length===0
  //    BEFORE crediting.
  const rewardId = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(inviteRewards)
      .values({
        inviterUserId,
        inviteeUserId: opts.inviteeUserId,
        workspaceId: opts.workspaceId,
        status,
        blockReason,
        amountMinor,
        currency,
        triggerAnnotationId: opts.triggerAnnotationId,
        grantedAt,
      })
      .onConflictDoNothing({
        target: [
          inviteRewards.inviterUserId,
          inviteRewards.inviteeUserId,
          inviteRewards.workspaceId,
        ],
      })
      .returning({ id: inviteRewards.id })
    if (inserted.length === 0) return null // raced; let the winner finish

    const id = inserted[0].id

    if (status === 'granted') {
      await creditInviterWalletTx({
        tx,
        inviterUserId,
        workspaceId: opts.workspaceId,
        amountMinor,
        currency,
        refRewardId: id,
        memo: `Invite reward — invitee hit ${INVITE_REWARD_THRESHOLD} approved annotations`,
      })
    }

    await tx.insert(events).values({
      type:
        status === 'granted'
          ? 'invite_reward.granted'
          : status === 'manual_review'
            ? 'invite_reward.manual_review'
            : 'invite_reward.blocked',
      workspaceId: opts.workspaceId,
      actorId: null, // system-triggered
      payload: {
        rewardId: id,
        inviterUserId,
        inviteeUserId: opts.inviteeUserId,
        amountMinor,
        currency,
        reason: blockReason,
      },
    })

    return id
  })

  if (!rewardId) return // raced; nothing more to do

  // 6. Out-of-transaction side effects — notification is best-effort;
  //    a failure here cannot rollback the wallet credit (which is what
  //    we want — the money moved correctly, the inbox row didn't).
  if (status === 'granted') {
    await emitNotification({
      userId: inviterUserId,
      workspaceId: opts.workspaceId,
      type: 'invite_reward.granted',
      title: `+¥${amountMinor / 100} invite reward credited`,
      body: `${invitee.email.split('@')[0]} reached ${INVITE_REWARD_THRESHOLD} approved annotations. Check /my/earnings.`,
      linkUrl: '/my/earnings',
      payload: {
        rewardId,
        amountMinor,
        currency,
      },
    }).catch(() => {
      // Inbox is best-effort; don't fail the credit on notification glitch.
    })
  }
}
