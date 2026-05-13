import 'server-only'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { taskTopicScopes, tasks } from '@/lib/db/schema'
import type { TopicScope } from '@/lib/ai/topic-scope'

/**
 * Topic-scope reader — used by the proxy route on every forwarded request.
 *
 * Lookup precedence (the proxy doesn't know which task a key is bound to
 * yet — see schema comments — so we fall back gracefully):
 *
 *   1. Task-specific scope, if `taskId` is provided AND a row exists for
 *      that task. (Future: when api-keys carry a taskId, prefer this.)
 *   2. Workspace fallback (`task_id IS NULL`) — the catch-all scope
 *      generated from the workspace's most-recent task on first request.
 *   3. Null — meaning "no scope configured yet, proxy passes through
 *      with no injection". The proxy logs a warn but doesn't 500.
 *
 * Returns the full row so callers can show version + edit metadata.
 */

export interface ResolvedTopicScope {
  id: string
  workspaceId: string
  taskId: string | null
  scope: TopicScope
  version: number
  generatedBy: string
  generatedAt: Date
  manuallyEditedAt: Date | null
}

export async function resolveTopicScope(opts: {
  workspaceId: string
  taskId?: string | null
}): Promise<ResolvedTopicScope | null> {
  const db = getDb()
  // 1. Try the task-specific row first if a taskId was supplied.
  if (opts.taskId) {
    const [taskRow] = await db
      .select()
      .from(taskTopicScopes)
      .where(
        and(
          eq(taskTopicScopes.workspaceId, opts.workspaceId),
          eq(taskTopicScopes.taskId, opts.taskId),
        ),
      )
      .limit(1)
    if (taskRow) return toResolved(taskRow)
  }

  // 2. Workspace fallback (task_id IS NULL).
  const [fallbackRow] = await db
    .select()
    .from(taskTopicScopes)
    .where(
      and(
        eq(taskTopicScopes.workspaceId, opts.workspaceId),
        isNull(taskTopicScopes.taskId),
      ),
    )
    .limit(1)
  if (fallbackRow) return toResolved(fallbackRow)

  return null
}

/**
 * Find the most representative task to base a fallback scope on.
 *
 * Strategy: latest non-draft task with a description. The first task in
 * a workspace is usually the canonical one; if a publisher creates a
 * second task they probably want either (a) per-task scoping (set
 * task_id explicitly) or (b) a manual edit.
 */
export async function findPrimaryTaskForScope(
  workspaceId: string,
): Promise<{ id: string; name: string; description: string } | null> {
  const db = getDb()
  const rows = await db
    .select({
      id: tasks.id,
      name: tasks.name,
      description: tasks.description,
    })
    .from(tasks)
    .where(eq(tasks.workspaceId, workspaceId))
    .orderBy(desc(tasks.createdAt))
    .limit(10)
  // Pick the first one with a non-empty description.
  for (const r of rows) {
    if (r.description && r.description.trim().length > 0) {
      return { id: r.id, name: r.name, description: r.description }
    }
  }
  return null
}

function toResolved(
  row: typeof taskTopicScopes.$inferSelect,
): ResolvedTopicScope {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    taskId: row.taskId,
    scope: {
      inScope: (row.inScope ?? []) as string[],
      outOfScope: (row.outOfScope ?? []) as string[],
      suffix: row.suffix,
    },
    version: row.version,
    generatedBy: row.generatedBy,
    generatedAt: row.generatedAt,
    manuallyEditedAt: row.manuallyEditedAt,
  }
}
