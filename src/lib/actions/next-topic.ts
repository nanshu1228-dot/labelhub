'use server'

/**
 * nextTopicInTask — find the next topic the current user can work on in a
 * task, for the labeler "auto-advance to next topic after submit" flow.
 *
 * Correct by construction: a topic is workable-by-me iff its task is open,
 * its status is still 'drafting' (submit moves a topic OFF 'drafting', so
 * this excludes anything already submitted by anyone), and it's either
 * unclaimed or already assigned to me (so we never point at another
 * annotator's claimed work). Read-only — the annotate page / submit handles
 * the actual claim. Returns null when there's nothing left (caller falls
 * back to the task page).
 */

import { z } from 'zod'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { tasks, topics } from '@/lib/db/schema'
import { requireWorkspaceMember } from '@/lib/auth/guards'
import { NotFoundError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'

const Input = z.object({
  taskId: uuidLike,
  /** Don't return the topic the labeler just submitted (race-safety). */
  excludeTopicId: uuidLike.optional(),
})

export async function nextTopicInTask(
  input: z.infer<typeof Input>,
): Promise<{ topicId: string; workspaceId: string } | null> {
  const parsed = Input.parse(input)
  const db = getDb()

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, parsed.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const { user } = await requireWorkspaceMember(task.workspaceId)

  // Closed/paused tasks have nothing to advance into.
  if (task.status !== 'open') return null

  const rows = await db
    .select({ id: topics.id })
    .from(topics)
    .where(
      and(
        eq(topics.taskId, task.id),
        eq(topics.status, 'drafting'),
        or(isNull(topics.assignedTo), eq(topics.assignedTo, user.id)),
      ),
    )
    .orderBy(asc(topics.createdAt))
    .limit(10)

  const next = rows.find((r) => r.id !== parsed.excludeTopicId)
  return next ? { topicId: next.id, workspaceId: task.workspaceId } : null
}
