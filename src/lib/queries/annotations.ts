import 'server-only'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  stepAnnotations,
  tasks,
  topics,
  workspaces,
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
 * Annotator's full submission history across every workspace they
 * belong to. Joins workspace + task + topic so the UI can render each
 * row with `workspaceName · taskName · topicId` breadcrumb without N+1
 * fetches.
 *
 * Returns BOTH submitted (status != drafting) AND in-progress drafts so
 * the page can split them into "submitted" vs "in flight" sections.
 */
export interface MySubmissionRow {
  annotationId: string
  topicId: string
  taskId: string
  taskName: string
  templateMode: string
  workspaceId: string
  workspaceName: string
  topicStatus: string
  /** ISO when the user submitted (null if still drafting). */
  submittedAt: Date | null
  /** ISO when the draft was first created. */
  createdAt: Date | null
  /** Payload preview — first 200 chars of stringified payload. */
  payloadPreview: string
}

export async function listMyAllSubmissions(opts: {
  userId: string
  /** Optional workspace filter; when omitted spans every workspace. */
  workspaceId?: string
  limit?: number
}): Promise<MySubmissionRow[]> {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 100, 500)
  const conds = [eq(annotations.userId, opts.userId)]
  const rows = await db
    .select({
      annotationId: annotations.id,
      topicId: annotations.topicId,
      taskId: tasks.id,
      taskName: tasks.name,
      templateMode: tasks.templateMode,
      workspaceId: tasks.workspaceId,
      workspaceName: workspaces.name,
      topicStatus: topics.status,
      submittedAt: annotations.submittedAt,
      payload: annotations.payload,
    })
    .from(annotations)
    .innerJoin(topics, eq(annotations.topicId, topics.id))
    .innerJoin(tasks, eq(topics.taskId, tasks.id))
    .innerJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
    .where(
      opts.workspaceId
        ? and(...conds, eq(tasks.workspaceId, opts.workspaceId))
        : and(...conds),
    )
    .orderBy(desc(annotations.submittedAt))
    .limit(limit)

  return rows.map((r) => {
    const payload = (r.payload ?? {}) as Record<string, unknown>
    let preview = ''
    try {
      preview = JSON.stringify(payload).slice(0, 200)
    } catch {
      preview = '(unparseable)'
    }
    return {
      annotationId: r.annotationId,
      topicId: r.topicId,
      taskId: r.taskId,
      taskName: r.taskName,
      templateMode: r.templateMode,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      topicStatus: r.topicStatus,
      submittedAt: r.submittedAt ?? null,
      createdAt: r.submittedAt ?? null, // annotations table has no createdAt; submittedAt is the closest
      payloadPreview: preview,
    }
  })
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
