import 'server-only'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  stepAnnotations,
  tasks,
  topics,
} from '@/lib/db/schema'

/**
 * Annotation read-side queries — drive the admin review queue + annotator history.
 *
 * Auth is the caller's responsibility.
 */

export async function getAnnotationById(annotationId: string) {
  const db = getDb()
  const [ann] = await db
    .select()
    .from(annotations)
    .where(eq(annotations.id, annotationId))
    .limit(1)
  return ann ?? null
}

/**
 * Review queue: all submitted annotations in a task (most recent first).
 * Admin sees this to decide approve / reject / request revision.
 */
export async function listSubmittedAnnotationsForTask(
  taskId: string,
  opts?: { limit?: number; offset?: number },
) {
  const db = getDb()
  const limit = Math.min(opts?.limit ?? 50, 200)
  return db
    .select({
      annotation: annotations,
      topic: topics,
    })
    .from(annotations)
    .innerJoin(topics, eq(annotations.topicId, topics.id))
    .where(
      and(
        eq(topics.taskId, taskId),
        isNotNull(annotations.submittedAt),
      ),
    )
    .orderBy(desc(annotations.submittedAt))
    .limit(limit)
    .offset(opts?.offset ?? 0)
}

/**
 * Annotator's own submission history across a workspace.
 */
export async function listMyAnnotations(
  userId: string,
  opts?: { workspaceId?: string; limit?: number; offset?: number },
) {
  const db = getDb()
  const limit = Math.min(opts?.limit ?? 50, 200)
  const conds = [eq(annotations.userId, userId)]
  return db
    .select({
      annotation: annotations,
      topic: topics,
      task: tasks,
    })
    .from(annotations)
    .innerJoin(topics, eq(annotations.topicId, topics.id))
    .innerJoin(tasks, eq(topics.taskId, tasks.id))
    .where(
      opts?.workspaceId
        ? and(...conds, eq(tasks.workspaceId, opts.workspaceId))
        : and(...conds),
    )
    .orderBy(desc(annotations.submittedAt))
    .limit(limit)
    .offset(opts?.offset ?? 0)
}

/**
 * Fetch annotation + its step-level marks in one go.
 * Powers the "View Annotation" detail page.
 */
export async function getAnnotationWithStepMarks(annotationId: string) {
  const ann = await getAnnotationById(annotationId)
  if (!ann) return null

  const db = getDb()
  const stepMarks = await db
    .select()
    .from(stepAnnotations)
    .where(eq(stepAnnotations.annotationId, annotationId))

  return { annotation: ann, stepAnnotations: stepMarks }
}

/**
 * Bulk fetch step annotations for many annotations at once (export / dashboard use).
 */
export async function listStepAnnotationsForAnnotations(
  annotationIds: string[],
) {
  if (annotationIds.length === 0) return []
  const db = getDb()
  return db
    .select()
    .from(stepAnnotations)
    .where(inArray(stepAnnotations.annotationId, annotationIds))
}
