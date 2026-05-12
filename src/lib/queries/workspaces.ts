import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { workspaceMembers, workspaces } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth/guards'

/**
 * Read-only workspace queries for Server Components.
 *
 * For mutations, see `lib/actions/workspaces.ts`. These functions return data
 * without modifying state; auth happens at the page/action layer.
 */

/** Single workspace by id. Returns null if not found. Auth is the caller's responsibility. */
export async function getWorkspaceById(id: string) {
  const db = getDb()
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1)
  return ws ?? null
}

/**
 * Every workspace the current user belongs to (any role).
 *
 * Joined through `workspace_members` so non-admin members are included.
 * Falls back to the legacy `workspaces.admin_id` so users who exist only
 * through the old path are still visible.
 */
export async function listWorkspacesForCurrentUser() {
  const user = await requireUser()
  const db = getDb()
  // Member rows
  const memberRows = await db
    .select({
      workspace: workspaces,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.joinedAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, user.id))
    .orderBy(desc(workspaceMembers.joinedAt))

  // Legacy: workspaces.admin_id rows where the user has no member row yet
  // (happens for very old data not yet backfilled).
  const memberIds = new Set(memberRows.map((r) => r.workspace.id))
  const legacyRows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.adminId, user.id))

  const out = [...memberRows]
  for (const w of legacyRows) {
    if (!memberIds.has(w.id)) {
      out.push({ workspace: w, role: 'admin', joinedAt: w.createdAt })
    }
  }
  return out
}

/**
 * Hot-path lookup: is this user a member of this workspace? Used by the
 * Server Actions that don't want the throw-on-not-member behavior of the
 * guards (e.g. listing workspaces in a sidebar).
 */
export async function getMembership(
  userId: string,
  workspaceId: string,
): Promise<{ role: 'admin' | 'annotator' | 'viewer' } | null> {
  const db = getDb()
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1)
  if (row) return { role: row.role as 'admin' | 'annotator' | 'viewer' }
  // Legacy fallback
  const [legacy] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.adminId, userId)))
    .limit(1)
  return legacy ? { role: 'admin' } : null
}
