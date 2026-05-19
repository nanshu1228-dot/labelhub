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
 * Cheap lookup for the /account page — return the workspace names
 * that are still claimable so the CTA can show them by name (not just
 * "N workspaces"). Empty array → no CTA renders.
 *
 * **Auth-gated** (3rd security audit): anonymous Server-Action POSTers
 * could previously enumerate seed-workspace names. Now requires a
 * signed-in user; the /account page is auth-only anyway so this is
 * net-zero for legitimate callers but blocks scraping.
 */
export async function listUnclaimedSeededWorkspaces(): Promise<
  Array<{ id: string; name: string }>
> {
  await requireUser()
  const db = getDb()
  return db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(like(workspaces.adminId, SEED_ADMIN_PREFIX))
    .limit(8)
}

/**
 * Backwards-compatible count helper. Kept so callers that only need
 * a number can stay as-is.
 */
export async function countUnclaimedSeededWorkspaces(): Promise<number> {
  // Auth check happens transitively via listUnclaimedSeededWorkspaces().
  const rows = await listUnclaimedSeededWorkspaces()
  return rows.length
}

/**
 * Claim every seeded workspace as the calling user. Returns the
 * workspace ids + names that were actually claimed (i.e. the
 * conditional UPDATE matched a still-orphaned row), plus the ones
 * lost to a concurrent claimer so the UI can show "we got 3, missed
 * 1 — someone else beat you to it".
 *
 * Race-safety: the UPDATE filters BOTH on workspace id AND that the
 * admin_id still looks like the seed sentinel. If a concurrent
 * request already swapped the admin_id to a real UUID, our UPDATE
 * matches zero rows and we skip the membership upsert + audit event
 * for that workspace. No silent overwrite.
 */
export async function claimSeededWorkspaces(): Promise<{
  ok: true
  claimed: Array<{ workspaceId: string; workspaceName: string }>
  /** Workspaces that were seeded when we read them but got claimed
   *  by another user before our UPDATE landed. Always 0 in
   *  single-user demo mode, but worth surfacing for transparency. */
  lostToRace: Array<{ workspaceId: string; workspaceName: string }>
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
    return { ok: true, claimed: [], lostToRace: [] }
  }

  const claimed: Array<{ workspaceId: string; workspaceName: string }> = []
  const lostToRace: Array<{ workspaceId: string; workspaceName: string }> = []

  for (const ws of seeded) {
    // 1. Conditional update: only swap admin_id if it STILL matches
    //    the sentinel. Two races we need to defeat:
    //      a) User B claimed between our SELECT and UPDATE → admin_id
    //         is now B's real UUID, our LIKE no longer matches, RETURNING
    //         comes back empty.
    //      b) Same workspace appears twice in `seeded` (impossible with
    //         unique id, but defensive).
    //    Empty RETURNING means "we lost the race"; record it and skip
    //    the membership/audit work.
    const updated = await db
      .update(workspaces)
      .set({ adminId: me.id })
      .where(
        and(
          eq(workspaces.id, ws.id),
          like(workspaces.adminId, SEED_ADMIN_PREFIX),
        ),
      )
      .returning({ id: workspaces.id })

    if (updated.length === 0) {
      lostToRace.push({ workspaceId: ws.id, workspaceName: ws.name })
      continue
    }

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
  // that might be cached. We deliberately don't revalidate each
  // claimed workspace's detail page — the next visit will SSR fresh
  // membership.
  try {
    revalidatePath('/account')
    revalidatePath('/admin')
  } catch {
    /* */
  }
  return { ok: true, claimed, lostToRace }
}
