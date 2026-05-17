import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  inviteRewards,
  users,
  workspaceInvites,
  workspaceMembers,
} from '@/lib/db/schema'

/**
 * Read helpers for invite-reward UI surfaces (Phase-13).
 *
 *   listMyInviteRewards     — annotator view on /my/earnings
 *   getWorkspaceInviteFunnel — admin dashboard: invited → joined → 5
 *                              approved → granted breakdown
 *   listManualReviewRewards — admin queue of pending manual-review rows
 */

export interface MyInviteRewardRow {
  id: string
  inviteeEmail: string | null
  inviteeDisplayName: string | null
  workspaceId: string
  amountMinor: number
  currency: string
  status: string
  blockReason: string | null
  createdAt: Date
  grantedAt: Date | null
}

export async function listMyInviteRewards(opts: {
  userId: string
  limit?: number
}): Promise<MyInviteRewardRow[]> {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 50, 200)

  const rows = await db
    .select({
      id: inviteRewards.id,
      inviteeUserId: inviteRewards.inviteeUserId,
      inviteeEmail: users.email,
      inviteeDisplayName: users.displayName,
      workspaceId: inviteRewards.workspaceId,
      amountMinor: inviteRewards.amountMinor,
      currency: inviteRewards.currency,
      status: inviteRewards.status,
      blockReason: inviteRewards.blockReason,
      createdAt: inviteRewards.createdAt,
      grantedAt: inviteRewards.grantedAt,
    })
    .from(inviteRewards)
    .leftJoin(users, eq(users.id, inviteRewards.inviteeUserId))
    .where(eq(inviteRewards.inviterUserId, opts.userId))
    .orderBy(desc(inviteRewards.createdAt))
    .limit(limit)

  return rows.map((r) => ({
    id: r.id,
    inviteeEmail: r.inviteeEmail,
    inviteeDisplayName: r.inviteeDisplayName,
    workspaceId: r.workspaceId,
    amountMinor: r.amountMinor,
    currency: r.currency,
    status: r.status,
    blockReason: r.blockReason,
    createdAt: r.createdAt,
    grantedAt: r.grantedAt,
  }))
}

/**
 * Aggregate "invite funnel" for a workspace — admin dashboard view.
 *
 * Steps (each is a strict subset of the previous):
 *   invited     — workspace_invites rows (admin sent an invite)
 *   joined      — invitee accepted (workspace_members.invitedBy IS NOT NULL)
 *   completed   — invitee crossed the threshold (invite_rewards row exists)
 *   granted     — auto-granted (no manual review)
 *   pending_rev — manual_review awaiting admin
 *   blocked     — admin denied
 *
 * Money totals are summed per currency since a workspace can mix.
 */
export interface InviteFunnel {
  invited: number
  joined: number
  completed: number
  granted: number
  pendingReview: number
  blocked: number
  /** Per-currency tally of amounts already granted, in MINOR units. */
  grantedByCurrency: Record<string, number>
}

export async function getWorkspaceInviteFunnel(
  workspaceId: string,
): Promise<InviteFunnel> {
  const db = getDb()

  const [invitedRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workspaceInvites)
    .where(eq(workspaceInvites.workspaceId, workspaceId))

  const [joinedRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        sql`${workspaceMembers.invitedBy} IS NOT NULL`,
      ),
    )

  const statusRows = await db
    .select({
      status: inviteRewards.status,
      currency: inviteRewards.currency,
      amount: sql<number>`SUM(${inviteRewards.amountMinor})::int`,
      n: sql<number>`count(*)::int`,
    })
    .from(inviteRewards)
    .where(eq(inviteRewards.workspaceId, workspaceId))
    .groupBy(inviteRewards.status, inviteRewards.currency)

  let completed = 0
  let granted = 0
  let pendingReview = 0
  let blocked = 0
  const grantedByCurrency: Record<string, number> = {}
  for (const r of statusRows) {
    const nn = Number(r.n ?? 0)
    completed += nn
    if (r.status === 'granted') {
      granted += nn
      grantedByCurrency[r.currency] =
        (grantedByCurrency[r.currency] ?? 0) + Number(r.amount ?? 0)
    } else if (r.status === 'manual_review') {
      pendingReview += nn
    } else if (r.status === 'blocked') {
      blocked += nn
    }
  }

  return {
    invited: Number(invitedRow?.n ?? 0),
    joined: Number(joinedRow?.n ?? 0),
    completed,
    granted,
    pendingReview,
    blocked,
    grantedByCurrency,
  }
}

export interface ManualReviewRow {
  id: string
  inviterUserId: string
  inviterEmail: string | null
  inviterDisplayName: string | null
  inviteeUserId: string
  inviteeEmail: string | null
  inviteeDisplayName: string | null
  amountMinor: number
  currency: string
  blockReason: string | null
  status: string
  createdAt: Date
}

/**
 * Admin manual-review queue — rows with status='manual_review' OR
 * 'blocked' (so admin can also reverse blocks). Sorted oldest-first
 * so the queue drains FIFO.
 */
export async function listManualReviewRewards(
  workspaceId: string,
): Promise<ManualReviewRow[]> {
  const db = getDb()
  // We need two joins (inviter user, invitee user) — drizzle doesn't
  // alias the same table twice cleanly, so do two queries and merge.
  const baseRows = await db
    .select()
    .from(inviteRewards)
    .where(
      and(
        eq(inviteRewards.workspaceId, workspaceId),
        sql`${inviteRewards.status} IN ('manual_review', 'blocked')`,
      ),
    )
    .orderBy(inviteRewards.createdAt)
  if (baseRows.length === 0) return []

  const userIds = Array.from(
    new Set(
      baseRows.flatMap((r) => [r.inviterUserId, r.inviteeUserId]),
    ),
  )
  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(users)
    .where(sql`${users.id} = ANY(${userIds})`)
  const byId = new Map(userRows.map((u) => [u.id, u]))

  return baseRows.map((r) => ({
    id: r.id,
    inviterUserId: r.inviterUserId,
    inviterEmail: byId.get(r.inviterUserId)?.email ?? null,
    inviterDisplayName: byId.get(r.inviterUserId)?.displayName ?? null,
    inviteeUserId: r.inviteeUserId,
    inviteeEmail: byId.get(r.inviteeUserId)?.email ?? null,
    inviteeDisplayName: byId.get(r.inviteeUserId)?.displayName ?? null,
    amountMinor: r.amountMinor,
    currency: r.currency,
    blockReason: r.blockReason,
    status: r.status,
    createdAt: r.createdAt,
  }))
}
