import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { toolProviders } from '@/lib/db/schema'

export async function listToolProvidersInWorkspace(workspaceId: string) {
  const db = getDb()
  return db
    .select()
    .from(toolProviders)
    .where(eq(toolProviders.workspaceId, workspaceId))
    .orderBy(asc(toolProviders.identifier))
}

export async function getToolProvider(id: string) {
  const db = getDb()
  const [provider] = await db
    .select()
    .from(toolProviders)
    .where(eq(toolProviders.id, id))
    .limit(1)
  return provider ?? null
}
