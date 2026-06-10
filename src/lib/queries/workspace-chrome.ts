import 'server-only'
import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { workspaces } from '@/lib/db/schema'

/**
 * Minimal workspace identity for chrome (sub-nav, breadcrumbs).
 *
 * Wrapped in React.cache so the `[id]` layout and any page that also
 * needs the name/mode share a single round-trip per request. Returns
 * null on miss or DB error so chrome degrades gracefully (the page's
 * own guard owns the real 404 / redirect).
 */
export type WorkspaceChrome = {
  id: string
  name: string
  templateMode: string
}

export const getWorkspaceChrome = cache(
  async (workspaceId: string): Promise<WorkspaceChrome | null> => {
    try {
      const db = getDb()
      const rows = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          templateMode: workspaces.templateMode,
        })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1)
      return rows[0] ?? null
    } catch {
      return null
    }
  },
)
