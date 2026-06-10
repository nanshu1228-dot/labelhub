import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events } from '@/lib/db/schema'

/**
 * Capture-health read layer.
 *
 * The /api/proxy/* route persists every captured trajectory in a Next
 * `after()` hook — outside the client-facing response. When that persist
 * fails (DB down, validation reject, storage error), the client already
 * got a 200 with NO trajectory recorded. To keep that from being silent,
 * the proxy + persist-with-storage emit an append-only
 * `trajectory.capture_failed` event. This query surfaces the most recent
 * ones on the workspace's /api page so an admin notices the gap.
 */

export const CAPTURE_FAILED_EVENT_TYPE = 'trajectory.capture_failed'

export interface CaptureFailure {
  id: string
  ts: Date
  /** Error message recorded at failure time. */
  message: string
  /** Provider kind (proxy) or captured agentName (persist layer). */
  kind: string | null
  /** Upstream URL (proxy) or trajectory source (persist layer). */
  path: string | null
}

/**
 * Recent `trajectory.capture_failed` events for a workspace, newest first.
 * Read-only; default limit 5 (the /api page shows a small hint, not a log).
 */
export async function getRecentCaptureFailures(
  workspaceId: string,
  limit = 5,
): Promise<CaptureFailure[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: events.id,
      ts: events.ts,
      payload: events.payload,
    })
    .from(events)
    .where(
      and(
        eq(events.workspaceId, workspaceId),
        eq(events.type, CAPTURE_FAILED_EVENT_TYPE),
      ),
    )
    .orderBy(desc(events.ts))
    .limit(limit)

  return rows.map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>
    return {
      id: r.id,
      ts: r.ts,
      message:
        typeof p.message === 'string' ? p.message : 'Unknown capture error',
      kind: typeof p.kind === 'string' ? p.kind : null,
      path: typeof p.path === 'string' ? p.path : null,
    }
  })
}
