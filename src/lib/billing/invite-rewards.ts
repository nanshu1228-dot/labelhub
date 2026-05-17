import 'server-only'
import { and, count, eq, sql } from 'drizzle-orm'
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
 * Post a credit transaction + bump the wallet_balance materialized
 * snapshot. Returns the transaction id.
 *
 * We use UPSERT semantics on `wallet_balance` so a brand-new inviter
 * (no prior balance row) lands cleanly. The transactions row is the
 * source of truth — wallet_balance is rebuildable from it.
 */
async function creditInviterWallet(opts: {
  inviterUserId: string
  workspaceId: string
  amountMinor: number
  currency: string
  refRewardId: string
}): Promise<string> {
  const db = getDb()

  const [txn] = await db
    .insert(transactions)
    .values({
      userId: opts.inviterUserId,
      type: 'invite_reward',
      amountMinor: opts.amountMinor,
      currency: opts.currency,
      workspaceId: opts.workspaceId,
      refTable: 'invite_rewards',
      refId: opts.refRewardId,
      memo: `Invite reward — invitee hit ${INVITE_REWARD_THRESHOLD} approved annotations`,
    })
    .returning({ id: transactions.id })

  // Upsert wallet_balance via raw SQL (drizzle doesn't expose a clean
  // onConflict update for materialized snapshots like this one).
  await db.execute(sql`
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
  //    Uses event log so the count matches the authoritative trust
  //    source (annotation.approved events keyed on submitterUserId).
  const [tally] = await db
    .select({ n: sql<number>`count(*)::int` })
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

  // Use raw SQL ON CONFLICT to belt-and-suspenders against double-
  // grant if two approvals race. If a row already exists (unique
  // violation), DO NOTHING and bail out cleanly.
  const inserted = await db
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
  if (inserted.length === 0) return // someone else raced us; their row wins

  const rewardId = inserted[0].id

  // 6. If granted: credit the wallet + notify inviter.
  if (status === 'granted') {
    await creditInviterWallet({
      inviterUserId,
      workspaceId: opts.workspaceId,
      amountMinor,
      currency,
      refRewardId: rewardId,
    })

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
  } else if (status === 'manual_review') {
    // Notify workspace admins (we don't have a "broadcast to admins"
    // helper; rely on the audit log + admin dashboard to surface it).
    // Event row below covers the audit surface.
  }

  // 7. Audit event — surfaces in /audit "consensus/inbox/judge/…" log.
  await db.insert(events).values({
    type:
      status === 'granted'
        ? 'invite_reward.granted'
        : status === 'manual_review'
          ? 'invite_reward.manual_review'
          : 'invite_reward.blocked',
    workspaceId: opts.workspaceId,
    actorId: null, // system-triggered
    payload: {
      rewardId,
      inviterUserId,
      inviteeUserId: opts.inviteeUserId,
      amountMinor,
      currency,
      reason: blockReason,
    },
  })
}
