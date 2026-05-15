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
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  events,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema'
import {
  requireUser,
  requireWorkspaceAdmin,
  requireWorkspaceMember,
} from '@/lib/auth/guards'
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { sendSupabaseMagicInvite } from '@/lib/email/supabase-magic-link'

const ROLE = z.enum(['admin', 'qc', 'annotator', 'viewer'])
type Role = z.infer<typeof ROLE>

// ───────────────────────────────────────────────────────────────────────
// Invite by email
// ───────────────────────────────────────────────────────────────────────

const InviteInput = z.object({
  workspaceId: uuidLike,
  email: z.string().email().max(254),
  role: ROLE,
})

export async function inviteToWorkspace(
  input: z.infer<typeof InviteInput>,
): Promise<{
  ok: true
  mode: 'member-created' | 'invite-pending'
  /** Always surfaced so admin can hand-deliver or relay alongside the email. */
  inviteUrl?: string
  /** True when Supabase confirmed the magic-link email was queued. */
  emailSent?: boolean
  /** True when Supabase rate-limited (free tier ~4/hour per recipient).
   *  UI should suggest copy-link fallback for this attempt. */
  emailRateLimited?: boolean
  /** Surfaced Supabase / network error string, if any. */
  emailError?: string
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

  const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const inviteUrl = `${base}/invites/${token}`

  // Trigger Supabase to send the magic-link email. The email lands in the
  // invitee's inbox with a one-time-use link that signs them in (creating
  // their account if needed) and bounces through our /auth/callback to
  // /invites/[token] where they pick the "Accept" button.
  //
  // Fail-soft: if Supabase rate-limits (~4/hour per recipient on free tier)
  // or otherwise errors, the action still returns successfully and the UI
  // surfaces the copy-link fallback. The invite row was already written;
  // anyone with the link can use it.
  //
  // Workspace name is unused at this layer — the email template lives in
  // Supabase Dashboard → Auth → Email Templates and renders independently.
  void workspace
  let emailSent = false
  let emailRateLimited = false
  let emailError: string | undefined
  try {
    const r = await sendSupabaseMagicInvite({
      email,
      postSignInPath: `/invites/${token}`,
    })
    emailSent = r.ok
    emailRateLimited = r.rateLimited ?? false
    emailError = r.error
  } catch (e) {
    emailError = e instanceof Error ? e.message : 'unknown email error'
    // eslint-disable-next-line no-console
    console.warn('invite magic-link send failed:', emailError)
  }

  return {
    ok: true,
    mode: 'invite-pending',
    inviteUrl,
    emailSent,
    emailRateLimited,
    emailError,
  }
}

// ───────────────────────────────────────────────────────────────────────
// List pending invites — admin-only
// ───────────────────────────────────────────────────────────────────────

export async function listPendingInvites(workspaceId: string): Promise<
  Array<{
    id: string
    email: string
    role: Role
    token: string
    inviteUrl: string
    invitedBy: string
    inviterEmail: string | null
    createdAt: Date
    expiresAt: Date | null
  }>
> {
  await requireWorkspaceAdmin(workspaceId)
  const db = getDb()
  const rows = await db
    .select({
      id: workspaceInvites.id,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      token: workspaceInvites.token,
      invitedBy: workspaceInvites.invitedBy,
      inviterEmail: users.email,
      createdAt: workspaceInvites.createdAt,
      expiresAt: workspaceInvites.expiresAt,
    })
    .from(workspaceInvites)
    .leftJoin(users, eq(workspaceInvites.invitedBy, users.id))
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspaceId),
        isNull(workspaceInvites.acceptedAt),
      ),
    )
    .orderBy(desc(workspaceInvites.createdAt))

  const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'
  return rows.map((r) => ({
    ...r,
    role: r.role as Role,
    inviteUrl: `${base}/invites/${r.token}`,
  }))
}

// ───────────────────────────────────────────────────────────────────────
// Re-send invite email (or surface link again)
// ───────────────────────────────────────────────────────────────────────

const ResendInviteInput = z.object({ inviteId: uuidLike })

export async function resendInvite(
  input: z.infer<typeof ResendInviteInput>,
): Promise<{
  ok: true
  inviteUrl: string
  emailSent: boolean
  emailRateLimited: boolean
  emailError?: string
}> {
  const parsed = ResendInviteInput.parse(input)
  const db = getDb()
  const [invite] = await db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.id, parsed.inviteId))
    .limit(1)
  if (!invite) throw new NotFoundError('Invite')
  if (invite.acceptedAt) {
    throw new ConflictError('Invite has already been accepted.')
  }
  await requireWorkspaceAdmin(invite.workspaceId)

  const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const inviteUrl = `${base}/invites/${invite.token}`

  // Same Supabase magic-link path as the initial send. Free-tier rate
  // limit may bite if the admin spams resend — UI handles that case.
  const r = await sendSupabaseMagicInvite({
    email: invite.email,
    postSignInPath: `/invites/${invite.token}`,
  })

  return {
    ok: true,
    inviteUrl,
    emailSent: r.ok,
    emailRateLimited: r.rateLimited ?? false,
    emailError: r.error,
  }
}

// ───────────────────────────────────────────────────────────────────────
// Revoke a pending invite (e.g. sent to wrong email)
// ───────────────────────────────────────────────────────────────────────

const RevokeInviteInput = z.object({ inviteId: uuidLike })

export async function revokeInvite(
  input: z.infer<typeof RevokeInviteInput>,
): Promise<void> {
  const parsed = RevokeInviteInput.parse(input)
  const db = getDb()
  const [invite] = await db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.id, parsed.inviteId))
    .limit(1)
  if (!invite) throw new NotFoundError('Invite')
  if (invite.acceptedAt) {
    throw new ConflictError('Invite already accepted — remove the member instead.')
  }
  const { user } = await requireWorkspaceAdmin(invite.workspaceId)
  await db.delete(workspaceInvites).where(eq(workspaceInvites.id, invite.id))
  await db.insert(events).values({
    type: 'workspace.invite.revoked',
    workspaceId: invite.workspaceId,
    actorId: user.id,
    payload: { inviteId: invite.id, email: invite.email },
  })
  try {
    revalidatePath(`/workspaces/${invite.workspaceId}/members`)
  } catch {
    /* */
  }
}

// ───────────────────────────────────────────────────────────────────────
// List my workspaces (for /account)
// ───────────────────────────────────────────────────────────────────────

export async function listMyWorkspaces(): Promise<
  Array<{
    workspaceId: string
    workspaceName: string
    role: Role
    joinedAt: Date
  }>
> {
  const me = await requireUser()
  const db = getDb()
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.joinedAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, me.id))
    .orderBy(desc(workspaceMembers.joinedAt))
  return rows.map((r) => ({
    workspaceId: r.workspaceId,
    workspaceName: r.workspaceName,
    role: r.role as Role,
    joinedAt: r.joinedAt,
  }))
}

// ───────────────────────────────────────────────────────────────────────
// Update profile (display name)
// ───────────────────────────────────────────────────────────────────────

const UpdateProfileInput = z.object({
  displayName: z.string().min(1).max(60).nullable(),
})

export async function updateProfile(
  input: z.infer<typeof UpdateProfileInput>,
): Promise<{ ok: true }> {
  const parsed = UpdateProfileInput.parse(input)
  const me = await requireUser()
  const db = getDb()
  await db
    .update(users)
    .set({ displayName: parsed.displayName })
    .where(eq(users.id, me.id))
  try {
    revalidatePath('/account')
    revalidatePath('/', 'layout')
  } catch {
    /* */
  }
  return { ok: true }
}

// Suppress unused-var warning since `requireWorkspaceMember` is exported as a
// guard that other callers may use; we don't currently invoke it here.
void requireWorkspaceMember

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
  workspaceId: uuidLike,
  userId: uuidLike,
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
  workspaceId: uuidLike,
  userId: uuidLike,
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
