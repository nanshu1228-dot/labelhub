'use server'

/**
 * Seed-workspace claim flow.
 *
 * The seed scripts (`seed-rich-demo`, `seed-pair-arena-demo`, etc.) use
 * sentinel UUIDs of the form `00000000-0000-0000-0000-000000000XXX` for
 * the workspace's `adminId` because the real Supabase user UUID isn't
 * known at seed time. Result: a fresh signed-in user lands on /account,
 * sees zero workspaces, and has no obvious way to take over the demo.
 *
 * This action lets any signed-in user "claim" those orphan workspaces:
 * we update `workspaces.adminId` to point at the real user AND insert a
 * `workspace_members` row with role='admin'. Idempotent — re-running
 * is a no-op for already-claimed workspaces.
 *
 * Safe by construction:
 *   - Only workspaces whose adminId matches the seed sentinel pattern
 *     are eligible (real user-created workspaces are NEVER touched).
 *   - The action requires a signed-in user; no anonymous claim path.
 */

import { revalidatePath } from 'next/cache'
import { and, eq, like } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events, workspaceMembers, workspaces } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth/guards'

/**
 * Anything starting with `00000000-0000-0000-0000-` is a seeded admin
 * UUID. `like` with the wildcard `%` covers all variants.
 */
const SEED_ADMIN_PREFIX = '00000000-0000-0000-0000-%'

/**
 * Cheap count for the /account page — render the claim CTA only when
 * there's actually something to claim. Doesn't require auth (just
 * inspects which workspaces are still seed-orphaned).
 */
export async function countUnclaimedSeededWorkspaces(): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(like(workspaces.adminId, SEED_ADMIN_PREFIX))
  return rows.length
}

/**
 * Claim every seeded workspace as the calling user. Returns the
 * workspace ids + names that were claimed (or already claimed in a
 * prior call), so the UI can show a meaningful confirmation.
 */
export async function claimSeededWorkspaces(): Promise<{
  ok: true
  claimed: Array<{ workspaceId: string; workspaceName: string }>
}> {
  const me = await requireUser()
  const db = getDb()

  // Find every seeded workspace. We don't filter by membership here —
  // even if the user is already a member, we still want to upgrade
  // their role to 'admin' (matching the implicit owner intent).
  const seeded = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
    })
    .from(workspaces)
    .where(like(workspaces.adminId, SEED_ADMIN_PREFIX))

  if (seeded.length === 0) {
    return { ok: true, claimed: [] }
  }

  const claimed: Array<{ workspaceId: string; workspaceName: string }> = []

  for (const ws of seeded) {
    // 1. Promote me to the workspace's primary admin.
    await db
      .update(workspaces)
      .set({ adminId: me.id })
      .where(eq(workspaces.id, ws.id))

    // 2. Upsert membership: if I'm already a member, set role=admin;
    //    otherwise insert a fresh row. We can't use `onConflictDoUpdate`
    //    cleanly here because the unique index is on (ws, user) and
    //    Drizzle's typed builder needs the conflict target spelled out.
    const [existing] = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws.id),
          eq(workspaceMembers.userId, me.id),
        ),
      )
      .limit(1)

    if (existing) {
      await db
        .update(workspaceMembers)
        .set({ role: 'admin' })
        .where(eq(workspaceMembers.id, existing.id))
    } else {
      await db.insert(workspaceMembers).values({
        workspaceId: ws.id,
        userId: me.id,
        role: 'admin',
      })
    }

    // 3. Audit trail — claiming is a noteworthy event for the demo
    //    workspace's history. NOT a security event (the action is
    //    self-service for orphaned seeds), but worth recording so the
    //    activity log shows when the workspace switched hands.
    await db.insert(events).values({
      type: 'workspace.seed_claimed',
      workspaceId: ws.id,
      actorId: me.id,
      payload: { previousAdminPrefix: SEED_ADMIN_PREFIX.replace('%', '...') },
    })

    claimed.push({ workspaceId: ws.id, workspaceName: ws.name })
  }

  // Refresh the account page (workspace list) and any workspace pages
  // that might be cached.
  try {
    revalidatePath('/account')
    revalidatePath('/admin')
  } catch {
    /* */
  }
  return { ok: true, claimed }
}
