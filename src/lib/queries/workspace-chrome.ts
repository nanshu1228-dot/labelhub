import 'server-only'
import { cache } from 'react'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { workspaces, workspaceMembers } from '@/lib/db/schema'

/**
 * Minimal workspace identity for chrome (sub-nav, breadcrumbs),
 * scoped to the viewing user's membership.
 *
 * Returns null unless `userId` is a member of the workspace (or its
 * legacy admin_id owner) — the workspace name must never stream to
 * anonymous visitors or non-members, even though the page's own guard
 * owns the real 404 / redirect. Null also covers miss and DB error so
 * chrome degrades gracefully.
 *
 * Wrapped in React.cache so the `[id]` layout and any page that also
 * needs the name/mode share a single round-trip per request.
 */
export type WorkspaceChrome = {
  id: string
  name: string
  templateMode: string
}

export const getWorkspaceChrome = cache(
  async (
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceChrome | null> => {
    try {
      const db = getDb()
      const rows = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          templateMode: workspaces.templateMode,
          adminId: workspaces.adminId,
          memberId: workspaceMembers.userId,
        })
        .from(workspaces)
        .leftJoin(
          workspaceMembers,
          and(
            eq(workspaceMembers.workspaceId, workspaces.id),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .where(eq(workspaces.id, workspaceId))
        .limit(1)
      const row = rows[0]
      if (!row) return null
      // Same membership rule as auth/guards: members row, or the
      // legacy admin_id owner (pre-backfill workspaces).
      if (!row.memberId && row.adminId !== userId) return null
      return { id: row.id, name: row.name, templateMode: row.templateMode }
    } catch {
      return null
    }
  },
)
