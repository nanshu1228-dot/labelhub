'use server'

/**
 * Workspace membership Server Actions.
 *
 * The auth guards (`requireWorkspaceAdmin` / `requireWorkspaceMember`) read
 * from `workspace_members`. This module is how those rows get created.
 *
 *   invite(workspaceId, email, role)
 *      → if user exists: add member row immediately
 *      → if not: write invite row; consumed at sign-in
 *
 *   acceptInvite(token)        — called from the verification link
 *   removeMember(workspaceId, userId)
 *   changeMemberRole(workspaceId, userId, role)
 *
 * All admin-gated; the inviter must be a workspace admin.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  events,
  users,
  workspaceInvites,
  workspaceMembers,
} from '@/lib/db/schema'
import { requireUser, requireWorkspaceAdmin } from '@/lib/auth/guards'
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors'

const ROLE = z.enum(['admin', 'annotator', 'viewer'])
type Role = z.infer<typeof ROLE>

// ───────────────────────────────────────────────────────────────────────
// Invite by email
// ───────────────────────────────────────────────────────────────────────

const InviteInput = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().email().max(254),
  role: ROLE,
})

export async function inviteToWorkspace(
  input: z.infer<typeof InviteInput>,
): Promise<{
  ok: true
  mode: 'member-created' | 'invite-pending'
  /** When the invitee doesn't have an account yet, surface the link so the
   *  caller can hand it off via email (we don't send mail from here). */
  inviteUrl?: string
}> {
  const parsed = InviteInput.parse(input)
  const { user, workspace } = await requireWorkspaceAdmin(parsed.workspaceId)
  const email = parsed.email.toLowerCase()
  const db = getDb()

  // 1. If the invitee already has a `users` row, add a member row directly.
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (existingUser) {
    const [existingMembership] = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, parsed.workspaceId),
          eq(workspaceMembers.userId, existingUser.id),
        ),
      )
      .limit(1)
    if (existingMembership) {
      throw new ConflictError('User is already a member of this workspace.')
    }
    await db.insert(workspaceMembers).values({
      workspaceId: parsed.workspaceId,
      userId: existingUser.id,
      role: parsed.role,
      invitedBy: user.id,
    })
    await db.insert(events).values({
      type: 'workspace.member.added',
      workspaceId: parsed.workspaceId,
      actorId: user.id,
      payload: {
        userId: existingUser.id,
        role: parsed.role,
        mode: 'existing-user',
      },
    })
    try {
      revalidatePath(`/workspaces/${parsed.workspaceId}`)
    } catch {
      /* */
    }
    return { ok: true, mode: 'member-created' }
  }

  // 2. Otherwise create an invite row. Token = uuid the user clicks; the
  // verification handler matches email + token + acceptedAt is null.
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000) // 7 days
  await db.insert(workspaceInvites).values({
    workspaceId: parsed.workspaceId,
    email,
    role: parsed.role,
    invitedBy: user.id,
    token,
    expiresAt,
  })
  await db.insert(events).values({
    type: 'workspace.invite.created',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: {
      email,
      role: parsed.role,
    },
  })

  // The caller (a future UI) sends the invitee an email containing this URL.
  // We don't have email infra wired yet; surface the link so the admin can
  // hand-deliver it.
  const base =
    process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const inviteUrl = `${base}/invites/${token}`
  void workspace // workspace already validated
  return { ok: true, mode: 'invite-pending', inviteUrl }
}

// ───────────────────────────────────────────────────────────────────────
// Accept invite (called from /invites/[token] page or Server Action)
// ───────────────────────────────────────────────────────────────────────

const TokenInput = z.object({ token: z.string().uuid() })

export async function acceptInvite(
  input: z.infer<typeof TokenInput>,
): Promise<{ ok: true; workspaceId: string; role: Role }> {
  const parsed = TokenInput.parse(input)
  const user = await requireUser()
  const db = getDb()

  const [invite] = await db
    .select()
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.token, parsed.token),
        isNull(workspaceInvites.acceptedAt),
      ),
    )
    .limit(1)
  if (!invite) throw new NotFoundError('Invite (or already accepted)')

  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    throw new ValidationError(
      'Invite has expired — ask the workspace admin to send a new one.',
    )
  }
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new AppError(
      'INVITE_EMAIL_MISMATCH',
      'This invite was sent to a different email. Sign in with that account or ask for a new invite.',
      403,
    )
  }

  // Idempotency: if user already has a membership row, just mark the invite
  // accepted.
  const [existing] = await db
    .select({ id: workspaceMembers.id, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, invite.workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .limit(1)

  if (!existing) {
    await db.insert(workspaceMembers).values({
      workspaceId: invite.workspaceId,
      userId: user.id,
      role: invite.role,
      invitedBy: invite.invitedBy,
    })
  }

  await db
    .update(workspaceInvites)
    .set({ acceptedAt: sql`now()` })
    .where(eq(workspaceInvites.id, invite.id))

  await db.insert(events).values({
    type: 'workspace.invite.accepted',
    workspaceId: invite.workspaceId,
    actorId: user.id,
    payload: {
      inviteId: invite.id,
      role: invite.role,
    },
  })

  try {
    revalidatePath('/')
  } catch {
    /* */
  }
  return {
    ok: true,
    workspaceId: invite.workspaceId,
    role: (existing?.role ?? invite.role) as Role,
  }
}

// ───────────────────────────────────────────────────────────────────────
// Remove member
// ───────────────────────────────────────────────────────────────────────

const RemoveInput = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
})

export async function removeMember(
  input: z.infer<typeof RemoveInput>,
): Promise<void> {
  const parsed = RemoveInput.parse(input)
  const { workspace } = await requireWorkspaceAdmin(parsed.workspaceId)

  // Refuse to remove the workspace's primary admin (the creator).
  if (workspace.adminId === parsed.userId) {
    throw new ValidationError(
      "Can't remove the workspace creator. Promote another admin, transfer ownership, then retry.",
    )
  }

  const db = getDb()
  await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, parsed.workspaceId),
        eq(workspaceMembers.userId, parsed.userId),
      ),
    )
  await db.insert(events).values({
    type: 'workspace.member.removed',
    workspaceId: parsed.workspaceId,
    actorId: workspace.adminId,
    payload: { userId: parsed.userId },
  })

  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}`)
  } catch {
    /* */
  }
}

// ───────────────────────────────────────────────────────────────────────
// Change role
// ───────────────────────────────────────────────────────────────────────

const ChangeRoleInput = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  role: ROLE,
})

export async function changeMemberRole(
  input: z.infer<typeof ChangeRoleInput>,
): Promise<void> {
  const parsed = ChangeRoleInput.parse(input)
  const { user, workspace } = await requireWorkspaceAdmin(parsed.workspaceId)

  // The workspace creator can't be demoted by themselves; another admin can.
  if (
    workspace.adminId === parsed.userId &&
    parsed.role !== 'admin' &&
    parsed.userId === user.id
  ) {
    throw new ValidationError(
      'You are the workspace creator — promote another admin before demoting yourself.',
    )
  }

  const db = getDb()
  const [row] = await db
    .update(workspaceMembers)
    .set({ role: parsed.role })
    .where(
      and(
        eq(workspaceMembers.workspaceId, parsed.workspaceId),
        eq(workspaceMembers.userId, parsed.userId),
      ),
    )
    .returning({ id: workspaceMembers.id })
  if (!row) throw new NotFoundError('Member')

  await db.insert(events).values({
    type: 'workspace.member.role_changed',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: { userId: parsed.userId, role: parsed.role },
  })

  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}`)
  } catch {
    /* */
  }
}

// ───────────────────────────────────────────────────────────────────────
// List members (read-only, returns user info)
// ───────────────────────────────────────────────────────────────────────

export async function listWorkspaceMembers(workspaceId: string): Promise<
  Array<{
    userId: string
    email: string
    displayName: string | null
    role: Role
    joinedAt: Date
  }>
> {
  // Member can read the roster — informational, not destructive.
  await import('@/lib/auth/guards').then((m) =>
    m.requireWorkspaceMember(workspaceId),
  )
  const db = getDb()
  return (await db
    .select({
      userId: workspaceMembers.userId,
      email: users.email,
      displayName: users.displayName,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.joinedAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))) as Array<{
    userId: string
    email: string
    displayName: string | null
    role: Role
    joinedAt: Date
  }>
}
