import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { workspaces } from '@/lib/db/schema'
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

/** All workspaces the current user administers. Throws if not signed in. */
export async function listWorkspacesForCurrentUser() {
  const user = await requireUser()
  const db = getDb()
  return db.select().from(workspaces).where(eq(workspaces.adminId, user.id))
}
