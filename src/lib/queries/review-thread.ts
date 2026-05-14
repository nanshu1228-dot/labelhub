import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { annotations, events, users } from '@/lib/db/schema'

/**
 * Review thread — reconstruct the back-and-forth between admin reviewer
 * and annotator (submitter) from the events log.
 *
 * The four event types that compose a thread:
 *
 *   1. annotation.approved        — reviewer accepted (terminal but feedback may exist)
 *   2. annotation.rejected        — reviewer rejected (with optional feedback)
 *   3. annotation.revised         — reviewer requested revision (with feedback)
 *   4. annotation.review_replied  — submitter responded
 *
 * No new table; everything is derived from `events` so the audit log
 * remains the single source of truth.
 */

export interface ReviewThreadMessage {
  eventId: string
  ts: Date
  /** Who sent the message — 'reviewer' (admin) or 'submitter' (annotator). */
  authorRole: 'reviewer' | 'submitter'
  authorId: string | null
  authorDisplayName: string | null
  authorEmail: string | null
  /** Free-form message body. Empty string when reviewer's verdict had no note. */
  message: string
  /** Tag for UI styling. */
  kind: 'approved' | 'rejected' | 'revised' | 'reply'
}

const THREAD_EVENT_TYPES = [
  'annotation.approved',
  'annotation.rejected',
  'annotation.revised',
  'annotation.review_replied',
] as const

/**
 * Load the message thread for one annotation, oldest first.
 *
 * Filters via `payload.annotationId === annotationId` because the events
 * table doesn't have an annotation FK. Cheap at MVP scale (workspace events
 * count in the thousands, not millions).
 */
export async function getReviewThread(opts: {
  annotationId: string
}): Promise<ReviewThreadMessage[]> {
  const db = getDb()

  const rows = await db
    .select({
      id: events.id,
      type: events.type,
      ts: events.ts,
      actorId: events.actorId,
      payload: events.payload,
    })
    .from(events)
    .where(inArray(events.type, [...THREAD_EVENT_TYPES]))
    .orderBy(asc(events.ts))

  const filtered = rows.filter((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>
    return p.annotationId === opts.annotationId
  })
  if (filtered.length === 0) return []

  const actorIds = [
    ...new Set(filtered.map((r) => r.actorId).filter((id): id is string => !!id)),
  ]
  const userRows =
    actorIds.length > 0
      ? await db
          .select({
            id: users.id,
            displayName: users.displayName,
            email: users.email,
          })
          .from(users)
          .where(inArray(users.id, actorIds))
      : []
  const userById = new Map(userRows.map((u) => [u.id, u]))

  // Resolve who the original submitter is — used to classify "submitter"
  // role even when the actor on a `review_replied` event isn't the same as
  // the verdict events' actors.
  const [annotation] = await db
    .select({ userId: annotations.userId })
    .from(annotations)
    .where(eq(annotations.id, opts.annotationId))
    .limit(1)
  const submitterId = annotation?.userId

  return filtered.map((r): ReviewThreadMessage => {
    const p = (r.payload ?? {}) as Record<string, unknown>
    const message =
      typeof p.message === 'string'
        ? p.message
        : typeof p.feedback === 'string'
          ? p.feedback
          : ''
    const role: 'reviewer' | 'submitter' =
      r.actorId === submitterId ? 'submitter' : 'reviewer'
    const u = r.actorId ? userById.get(r.actorId) : undefined
    let kind: ReviewThreadMessage['kind']
    if (r.type === 'annotation.approved') kind = 'approved'
    else if (r.type === 'annotation.rejected') kind = 'rejected'
    else if (r.type === 'annotation.revised') kind = 'revised'
    else kind = 'reply'

    return {
      eventId: r.id,
      ts: r.ts,
      authorRole: role,
      authorId: r.actorId,
      authorDisplayName: u?.displayName ?? null,
      authorEmail: u?.email ?? null,
      message,
      kind,
    }
  })
}

/**
 * Lookup helper: given a workspace + trajectory + userId, find the
 * matching annotation id (if any) so the caller can fetch its thread.
 *
 * Returns null when the user hasn't annotated that trajectory.
 */
export async function findUserAnnotationForTrajectory(opts: {
  workspaceId: string
  trajectoryId: string
  userId: string
}): Promise<string | null> {
  const db = getDb()
  // Cheapest path: scan step_annotations + trajectory_steps to find the
  // user's annotation linked to this trajectory.
  const { stepAnnotations, trajectorySteps } = await import('@/lib/db/schema')
  const rows = await db
    .select({ annotationId: stepAnnotations.annotationId })
    .from(stepAnnotations)
    .innerJoin(
      trajectorySteps,
      eq(trajectorySteps.id, stepAnnotations.trajectoryStepId),
    )
    .innerJoin(annotations, eq(annotations.id, stepAnnotations.annotationId))
    .where(
      and(
        eq(trajectorySteps.trajectoryId, opts.trajectoryId),
        eq(annotations.userId, opts.userId),
      ),
    )
    .limit(1)
  return rows[0]?.annotationId ?? null
}
