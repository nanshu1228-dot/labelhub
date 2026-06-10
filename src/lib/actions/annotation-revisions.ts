'use server'

/**
 * Phase-10 annotation revision actions (admin-only).
 *
 *   listRevisionsForTopic({ topicId })
 *     → fetch all revisions for the (annotations on this topic)
 *     → admin-only — these are forensic / audit data, not for raters
 *
 *   restoreRevision({ revisionId })
 *     → admin picks a historical snapshot, we WRITE the snapshot's
 *       payload to the live annotation row AND emit a new
 *       'restore' revision row pointing at the source.
 *     → notify the rater so they know their work got rolled back +
 *       why (admin's note).
 *     → append-only: the original revision is preserved; restoring
 *       leaves a trail.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotationRevisions,
  annotations,
  events,
  tasks,
  topics,
  users,
} from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { uuidLike } from '@/lib/validators/uuid'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { writeRevision } from '@/lib/quality/annotation-revisions'
import { emitNotification } from '@/lib/notifications/emit'

const restoreInputSchema = z.object({
  revisionId: uuidLike,
  /** Optional reason — surfaced to the rater verbatim in their inbox
   *  so they know WHY their work was rolled back. */
  reason: z.string().max(2000).optional(),
})

export async function restoreAnnotationRevision(
  input: z.infer<typeof restoreInputSchema>,
): Promise<{ ok: true; annotationId: string; newRevisionId: string }> {
  const parsed = restoreInputSchema.parse(input)
  const db = getDb()

  // 1. Load the revision + its annotation row.
  const [rev] = await db
    .select({
      id: annotationRevisions.id,
      annotationId: annotationRevisions.annotationId,
      workspaceId: annotationRevisions.workspaceId,
      payload: annotationRevisions.payload,
      kind: annotationRevisions.kind,
      actorId: annotationRevisions.actorId,
      ts: annotationRevisions.ts,
    })
    .from(annotationRevisions)
    .where(eq(annotationRevisions.id, parsed.revisionId))
    .limit(1)
  if (!rev) throw new NotFoundError('Revision')

  // 2. Auth — admin of the revision's workspace.
  const { user: admin } = await requireWorkspaceAdmin(rev.workspaceId)

  // 3. Load the annotation + topic to figure out current state for
  //    audit; refuse to overwrite an already-approved annotation
  //    (those have payouts attached; restoring would silently
  //    invalidate them).
  const [ann] = await db
    .select({
      id: annotations.id,
      userId: annotations.userId,
      topicId: annotations.topicId,
      payload: annotations.payload,
      version: annotations.version,
    })
    .from(annotations)
    .where(eq(annotations.id, rev.annotationId))
    .limit(1)
  if (!ann) throw new NotFoundError('Annotation')
  const [topic] = await db
    .select({ status: topics.status, taskId: topics.taskId })
    .from(topics)
    .where(eq(topics.id, ann.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')
  if (topic.status === 'approved' || topic.status === 'rejected') {
    throw new ValidationError(
      `Cannot restore an annotation whose topic is ${topic.status}. Revert the verdict first if you need to roll back.`,
    )
  }

  // 4. Overwrite the live annotation payload + bump version. Note:
  //    we DON'T touch submittedAt — that's part of lifecycle, not
  //    payload truth. If the annotation was submitted and admin
  //    restores to a pre-submit revision, the topic still shows
  //    'submitted' status; admin may want to send-back-for-revision
  //    after.
  //
  //    Maintenance fix #7 — CAS on the version we just read; if the
  //    annotation moved (e.g. the original submitter pressed save in
  //    parallel) refuse rather than silently overwrite.
  const restoreResult = await db
    .update(annotations)
    .set({
      payload: rev.payload as object,
      version: ann.version + 1,
    })
    .where(
      and(
        eq(annotations.id, ann.id),
        eq(annotations.version, ann.version),
      ),
    )
    .returning({ id: annotations.id })
  if (restoreResult.length === 0) {
    throw new ConflictError(
      'Annotation changed since you opened the history. Refresh and try again.',
    )
  }

  // 5. Append a 'restore' revision row so the trail is complete.
  const written = await writeRevision({
    annotationId: ann.id,
    actorId: admin.id,
    workspaceId: rev.workspaceId,
    payload: rev.payload,
    kind: 'restore',
    prevRevisionId: rev.id,
  })

  // 6. Audit event for cross-workspace activity log.
  await db.insert(events).values({
    type: 'annotation.restored',
    workspaceId: rev.workspaceId,
    actorId: admin.id,
    payload: {
      annotationId: ann.id,
      topicId: ann.topicId,
      taskId: topic.taskId,
      sourceRevisionId: rev.id,
      newRevisionId: written?.revisionId ?? null,
      sourceKind: rev.kind,
      sourceTs: rev.ts.toISOString(),
      reason: parsed.reason?.trim() ?? null,
    },
  })

  // 7. Notify the rater (unless admin restored their own annotation —
  //    no point inboxing themselves).
  if (ann.userId !== admin.id) {
    const trimmed = parsed.reason?.trim()
    await emitNotification({
      userId: ann.userId,
      workspaceId: rev.workspaceId,
      type: 'annotation.restored',
      title: 'Your annotation was rolled back to a previous version',
      body:
        trimmed ??
        'An admin restored an earlier version of your draft — open it to see the changes.',
      linkUrl: `/workspaces/${rev.workspaceId}/topics/${ann.topicId}/annotate`,
      payload: {
        annotationId: ann.id,
        sourceRevisionId: rev.id,
        sourceTs: rev.ts.toISOString(),
      },
      actorId: admin.id,
    })
  }

  try {
    revalidatePath(
      `/workspaces/${rev.workspaceId}/topics/${ann.topicId}/annotate`,
    )
    revalidatePath(
      `/workspaces/${rev.workspaceId}/topics/${ann.topicId}/history`,
    )
    // 3rd audit: also repaint annotator-facing surfaces — restoring
    // an admin-rejected annotation flips its state and the submitter
    // should see it on their inbox / submissions list immediately.
    revalidatePath('/my/inbox')
    revalidatePath('/my/submissions')
    revalidatePath('/my/quality')
  } catch {
    /* */
  }

  return {
    ok: true,
    annotationId: ann.id,
    newRevisionId: written?.revisionId ?? '',
  }
}

// ─── Helper: admin-side listing for the history page ────────────────────

export interface RevisionRow {
  id: string
  ts: Date
  kind: string
  actorId: string
  actorDisplayName: string | null
  actorEmail: string | null
  byteSize: number
  prevRevisionId: string | null
}

export interface TopicRevisionList {
  annotationId: string
  annotatorDisplayName: string | null
  annotatorEmail: string | null
  revisions: RevisionRow[]
}

/**
 * Admin-only: pull all revisions for every annotation tied to the
 * topic. (Pair/arena tasks usually have one annotation per (topic,
 * user) so there's typically one row; trajectory tasks may have
 * multiple raters per topic, in which case we group.)
 */
export async function listRevisionsForTopic(
  input: z.infer<typeof topicIdSchema>,
): Promise<{ annotations: TopicRevisionList[] }> {
  const parsed = topicIdSchema.parse(input)
  const db = getDb()

  // Resolve workspaceId via topic → task and auth-gate.
  const [topic] = await db
    .select({ taskId: topics.taskId })
    .from(topics)
    .where(eq(topics.id, parsed.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')
  const [task] = await db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')
  await requireWorkspaceAdmin(task.workspaceId)

  // Pull annotations on this topic + the annotator names.
  const anns = await db
    .select({
      id: annotations.id,
      userId: annotations.userId,
      annotatorDisplayName: users.displayName,
      annotatorEmail: users.email,
    })
    .from(annotations)
    .innerJoin(users, eq(users.id, annotations.userId))
    .where(eq(annotations.topicId, parsed.topicId))
  if (anns.length === 0) return { annotations: [] }

  const annIds = anns.map((a) => a.id)
  const revs = await db
    .select({
      id: annotationRevisions.id,
      ts: annotationRevisions.ts,
      kind: annotationRevisions.kind,
      actorId: annotationRevisions.actorId,
      actorDisplayName: users.displayName,
      actorEmail: users.email,
      byteSize: annotationRevisions.byteSize,
      prevRevisionId: annotationRevisions.prevRevisionId,
      annotationId: annotationRevisions.annotationId,
    })
    .from(annotationRevisions)
    .innerJoin(users, eq(users.id, annotationRevisions.actorId))
    .where(
      // inArray() would be cleaner but matches an earlier prod bug
      // where drizzle didn't bind well — go with the small N anyway.
      annIds.length === 1
        ? eq(annotationRevisions.annotationId, annIds[0])
        : and(eq(annotationRevisions.workspaceId, task.workspaceId)),
    )
    .orderBy(desc(annotationRevisions.ts))

  const byAnn = new Map<string, RevisionRow[]>()
  for (const r of revs) {
    if (!annIds.includes(r.annotationId)) continue
    const list = byAnn.get(r.annotationId) ?? []
    list.push({
      id: r.id,
      ts: r.ts,
      kind: r.kind,
      actorId: r.actorId,
      actorDisplayName: r.actorDisplayName,
      actorEmail: r.actorEmail,
      byteSize: r.byteSize,
      prevRevisionId: r.prevRevisionId,
    })
    byAnn.set(r.annotationId, list)
  }

  return {
    annotations: anns.map((a) => ({
      annotationId: a.id,
      annotatorDisplayName: a.annotatorDisplayName,
      annotatorEmail: a.annotatorEmail,
      revisions: byAnn.get(a.id) ?? [],
    })),
  }
}

const topicIdSchema = z.object({ topicId: uuidLike })
