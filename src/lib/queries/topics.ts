import 'server-only'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { topics, tasks } from '@/lib/db/schema'

/**
 * Topic read-side queries — drive the annotator marketplace + reviewer queue.
 *
 * Auth is the caller's responsibility.
 */

export async function getTopicById(topicId: string) {
  const db = getDb()
  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, topicId))
    .limit(1)
  return topic ?? null
}

export async function listTopicsInTask(
  taskId: string,
  opts?: { status?: string | string[]; limit?: number; offset?: number },
) {
  const db = getDb()
  const limit = Math.min(opts?.limit ?? 100, 500)
  const conds = [eq(topics.taskId, taskId)]
  if (opts?.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status]
    if (statuses.length === 1) {
      conds.push(eq(topics.status, statuses[0] as never))
    }
  }
  return db
    .select()
    .from(topics)
    .where(conds.length === 1 ? conds[0] : and(...conds))
    .orderBy(asc(topics.createdAt))
    .limit(limit)
    .offset(opts?.offset ?? 0)
}

/**
 * Unclaimed topics in OPEN tasks across a workspace — the annotator marketplace feed.
 */
export async function listAvailableTopicsForWorkspace(
  workspaceId: string,
  opts?: { limit?: number },
) {
  const db = getDb()
  const limit = Math.min(opts?.limit ?? 50, 200)
  return db
    .select({
      topic: topics,
      task: tasks,
    })
    .from(topics)
    .innerJoin(tasks, eq(topics.taskId, tasks.id))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.status, 'open'),
        isNull(topics.assignedTo),
        eq(topics.status, 'drafting'),
      ),
    )
    .orderBy(desc(topics.createdAt))
    .limit(limit)
}

/**
 * Topics this user is currently working on (or have submitted but not been reviewed).
 */
export async function listMyClaimedTopics(
  userId: string,
  opts?: { workspaceId?: string; limit?: number },
) {
  const db = getDb()
  const limit = Math.min(opts?.limit ?? 50, 200)
  const conds = [eq(topics.assignedTo, userId)]
  return db
    .select({
      topic: topics,
      task: tasks,
    })
    .from(topics)
    .innerJoin(tasks, eq(topics.taskId, tasks.id))
    .where(
      opts?.workspaceId
        ? and(...conds, eq(tasks.workspaceId, opts.workspaceId))
        : and(...conds),
    )
    .orderBy(desc(topics.createdAt))
    .limit(limit)
}
