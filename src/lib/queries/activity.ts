import 'server-only'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events, users } from '@/lib/db/schema'

/**
 * Recent activity stream for a workspace's audit-log surface
 * (/workspaces/[id]/activity).
 *
 * The events table is append-only (Pillar 2: event sourcing) — every
 * mutation in the system writes one row. This returns the most recent
 * 200, newest first, left-joined to the actor's user record so the UI
 * can show "who did what" without a follow-up lookup. Null actorIds
 * (background jobs, AI hint generation, etc.) keep their null actor
 * fields and render as "system".
 */

const PAGE_SIZE = 200

export async function listWorkspaceActivity(workspaceId: string) {
  const db = getDb()
  return db
    .select({
      id: events.id,
      type: events.type,
      actorId: events.actorId,
      payload: events.payload,
      ts: events.ts,
      actorEmail: users.email,
      actorDisplayName: users.displayName,
    })
    .from(events)
    .leftJoin(users, eq(users.id, events.actorId))
    .where(eq(events.workspaceId, workspaceId))
    .orderBy(desc(events.ts))
    .limit(PAGE_SIZE)
}
