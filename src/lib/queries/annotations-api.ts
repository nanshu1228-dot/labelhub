import 'server-only'
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  stepAnnotations,
  tasks,
  topics,
  trajectorySteps,
  users,
} from '@/lib/db/schema'
import type { Mark } from '@/lib/templates/rubric'

/**
 * Customer-facing annotation views.
 *
 * The output shape here is the **stable external contract** — different from
 * what the React UI consumes internally. Internal UI freely mutates query
 * shape; this one stays stable and versioned with the API.
 *
 * Response field rules:
 *   - Dates → ISO strings (not Date objects) so JSON serialization is faithful
 *   - User PII reduced: email + displayName only (no internal flags)
 *   - Mark JSON kept as-is (the canonical {scale, value, reason?} shape)
 *   - status reflects the topic state at read time
 *   - reviewVerdict/feedback derived from the latest review event for this annotation
 */

export type ApiAnnotationStatus =
  | 'drafting'
  | 'revising'
  | 'submitted'
  | 'reviewing'
  | 'approved'
  | 'rejected'

export interface ApiAnnotation {
  id: string
  trajectoryId: string | null
  userId: string
  userEmail: string | null
  userDisplayName: string | null
  status: ApiAnnotationStatus
  submittedAt: string | null
  /** Last review event (approved/rejected/revised) — null when never reviewed. */
  reviewVerdict: 'approved' | 'rejected' | 'revised' | null
  reviewFeedback: string | null
  reviewedAt: string | null
  /** Trajectory-level rubric answers: { [rubricId]: Mark }. */
  trajectoryMarks: Record<string, Mark>
  /** Per-step rubric answers: { [stepId]: { [rubricId]: Mark } }. */
  stepMarks: Record<string, Record<string, Mark>>
}

export interface ApiAnnotationListOpts {
  workspaceId: string
  trajectoryId?: string
  /** Filter by status. Only emitted statuses pass; unknown values ignored. */
  status?: ApiAnnotationStatus
  /** ISO timestamp; inclusive — only annotations whose submittedAt >= this. */
  since?: string
  /** ISO timestamp; exclusive — only annotations whose submittedAt < this. */
  until?: string
  /** Page size; clamped to [1, 200]. Defaults to 50. */
  limit?: number
  /** Offset for paging. Defaults to 0. */
  offset?: number
}

export interface ApiAnnotationListResult {
  annotations: ApiAnnotation[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

/**
 * Bulk list of annotations for an API consumer. Filters narrow on either
 * trajectory_id, status, or a time window. Returns the canonical shape with
 * full marks bundle so a downstream training pipeline can pull a single
 * page and have everything it needs (no N+1).
 *
 * Auth: caller's API key auth must have already mapped to `workspaceId`.
 * This function trusts the workspaceId boundary — no extra guard inside.
 */
export async function listAnnotationsForApi(
  opts: ApiAnnotationListOpts,
): Promise<ApiAnnotationListResult> {
  const db = getDb()
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)

  // 1. Page over annotations in workspace, narrowed by filters.
  const conditions = [eq(tasks.workspaceId, opts.workspaceId)]
  if (opts.status) conditions.push(eq(topics.status, opts.status))
  if (opts.since) {
    const d = new Date(opts.since)
    if (!isNaN(d.getTime())) conditions.push(gte(annotations.submittedAt, d))
  }
  if (opts.until) {
    const d = new Date(opts.until)
    if (!isNaN(d.getTime())) conditions.push(lt(annotations.submittedAt, d))
  }

  // For trajectory filter we need to join through step_annotations / steps.
  const trajectoryIdFilter = opts.trajectoryId
    ? sql`exists (
        select 1 from ${stepAnnotations} sa
        inner join ${trajectorySteps} ts on ts.id = sa.trajectory_step_id
        where sa.annotation_id = ${annotations.id}
          and ts.trajectory_id = ${opts.trajectoryId}
      )`
    : sql`true`

  // Aggregate row count for pagination — same conditions, no marks join.
  const [{ n: total }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .where(and(...conditions, trajectoryIdFilter))) as Array<{ n: number }>

  const annotationRows = await db
    .select({
      id: annotations.id,
      userId: annotations.userId,
      userEmail: users.email,
      userDisplayName: users.displayName,
      submittedAt: annotations.submittedAt,
      payload: annotations.payload,
      topicStatus: topics.status,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .innerJoin(users, eq(users.id, annotations.userId))
    .where(and(...conditions, trajectoryIdFilter))
    .orderBy(desc(annotations.submittedAt))
    .limit(limit)
    .offset(offset)

  if (annotationRows.length === 0) {
    return { annotations: [], total: Number(total), limit, offset, hasMore: false }
  }

  // 2. Load step marks + trajectory linkage for the page.
  const ids = annotationRows.map((r) => r.id)
  const stepMarkRows = await db
    .select({
      annotationId: stepAnnotations.annotationId,
      trajectoryStepId: stepAnnotations.trajectoryStepId,
      rubricKind: stepAnnotations.kind,
      payload: stepAnnotations.payload,
      legacyRating: stepAnnotations.rating,
      legacyReasoning: stepAnnotations.reasoning,
      trajectoryId: trajectorySteps.trajectoryId,
    })
    .from(stepAnnotations)
    .innerJoin(
      trajectorySteps,
      eq(trajectorySteps.id, stepAnnotations.trajectoryStepId),
    )
    .where(inArray(stepAnnotations.annotationId, ids))

  // 3. Latest review event per annotation.
  const reviewEventRows = await db
    .select({
      ts: events.ts,
      type: events.type,
      payload: events.payload,
    })
    .from(events)
    .where(
      and(
        eq(events.workspaceId, opts.workspaceId),
        inArray(events.type, [
          'annotation.approved',
          'annotation.rejected',
          'annotation.revised',
        ]),
      ),
    )
    .orderBy(desc(events.ts))

  // Bucket helpers.
  const stepMarksByAnnotation = new Map<
    string,
    {
      trajectoryId: string | null
      stepMarks: Record<string, Record<string, Mark>>
    }
  >()
  for (const sm of stepMarkRows) {
    const slot = stepMarksByAnnotation.get(sm.annotationId) ?? {
      trajectoryId: null,
      stepMarks: {},
    }
    slot.trajectoryId = sm.trajectoryId
    const mark = decodeStepMark(sm.payload, sm.legacyRating, sm.legacyReasoning)
    if (mark) {
      const bucket = slot.stepMarks[sm.trajectoryStepId] ?? {}
      bucket[sm.rubricKind] = mark
      slot.stepMarks[sm.trajectoryStepId] = bucket
    }
    stepMarksByAnnotation.set(sm.annotationId, slot)
  }

  // Pick the FIRST (newest, desc-ordered) review event per annotation.
  const latestReviewByAnnotation = new Map<
    string,
    { ts: Date; type: string; feedback: string | null }
  >()
  for (const r of reviewEventRows) {
    const p = (r.payload ?? {}) as Record<string, unknown>
    const annId = typeof p.annotationId === 'string' ? p.annotationId : null
    if (!annId) continue
    if (latestReviewByAnnotation.has(annId)) continue // first wins (newest)
    latestReviewByAnnotation.set(annId, {
      ts: r.ts,
      type: r.type,
      feedback: typeof p.feedback === 'string' ? p.feedback : null,
    })
  }

  // 4. Assemble.
  const out: ApiAnnotation[] = annotationRows.map((row) => {
    const stepSlot = stepMarksByAnnotation.get(row.id) ?? {
      trajectoryId: null,
      stepMarks: {},
    }
    const trajMarks: Record<string, Mark> = {}
    const annPayload = (row.payload ?? {}) as Record<string, unknown>
    for (const [k, v] of Object.entries(annPayload)) {
      if (v && typeof v === 'object' && 'scale' in (v as object)) {
        trajMarks[k] = v as Mark
      }
    }
    const review = latestReviewByAnnotation.get(row.id) ?? null
    let reviewVerdict: ApiAnnotation['reviewVerdict'] = null
    if (review) {
      if (review.type === 'annotation.approved') reviewVerdict = 'approved'
      else if (review.type === 'annotation.rejected') reviewVerdict = 'rejected'
      else if (review.type === 'annotation.revised') reviewVerdict = 'revised'
    }
    return {
      id: row.id,
      trajectoryId: stepSlot.trajectoryId,
      userId: row.userId,
      userEmail: row.userEmail ?? null,
      userDisplayName: row.userDisplayName ?? null,
      status: (row.topicStatus as ApiAnnotationStatus) ?? 'drafting',
      submittedAt: row.submittedAt?.toISOString() ?? null,
      reviewVerdict,
      reviewFeedback: review?.feedback ?? null,
      reviewedAt: review?.ts.toISOString() ?? null,
      trajectoryMarks: trajMarks,
      stepMarks: stepSlot.stepMarks,
    }
  })

  return {
    annotations: out,
    total: Number(total),
    limit,
    offset,
    hasMore: offset + out.length < Number(total),
  }
}

/**
 * Single annotation lookup for an API consumer. Workspace-scoped.
 *
 * Returns null when the annotation doesn't exist OR belongs to a different
 * workspace (don't leak existence across tenants).
 */
export async function getAnnotationForApi(opts: {
  annotationId: string
  workspaceId: string
}): Promise<ApiAnnotation | null> {
  const result = await listAnnotationsForApi({
    workspaceId: opts.workspaceId,
    limit: 1,
  })
  // Cheap path: filter the bulk query. For perf we'd write a dedicated
  // single-row query but this works at MVP scale.
  const direct = result.annotations.find((a) => a.id === opts.annotationId)
  if (direct) return direct

  // Fallback: dedicated single-id load when paging didn't include it.
  const db = getDb()
  const [row] = await db
    .select({
      id: annotations.id,
      userId: annotations.userId,
      userEmail: users.email,
      userDisplayName: users.displayName,
      submittedAt: annotations.submittedAt,
      payload: annotations.payload,
      topicStatus: topics.status,
      workspaceId: tasks.workspaceId,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .innerJoin(users, eq(users.id, annotations.userId))
    .where(eq(annotations.id, opts.annotationId))
    .limit(1)
  if (!row) return null
  if (row.workspaceId !== opts.workspaceId) return null

  const stepMarkRows = await db
    .select({
      trajectoryStepId: stepAnnotations.trajectoryStepId,
      rubricKind: stepAnnotations.kind,
      payload: stepAnnotations.payload,
      legacyRating: stepAnnotations.rating,
      legacyReasoning: stepAnnotations.reasoning,
      trajectoryId: trajectorySteps.trajectoryId,
    })
    .from(stepAnnotations)
    .innerJoin(
      trajectorySteps,
      eq(trajectorySteps.id, stepAnnotations.trajectoryStepId),
    )
    .where(eq(stepAnnotations.annotationId, opts.annotationId))

  let trajectoryId: string | null = null
  const stepMarks: Record<string, Record<string, Mark>> = {}
  for (const sm of stepMarkRows) {
    trajectoryId = sm.trajectoryId
    const mark = decodeStepMark(sm.payload, sm.legacyRating, sm.legacyReasoning)
    if (mark) {
      const bucket = stepMarks[sm.trajectoryStepId] ?? {}
      bucket[sm.rubricKind] = mark
      stepMarks[sm.trajectoryStepId] = bucket
    }
  }

  const trajMarks: Record<string, Mark> = {}
  const annPayload = (row.payload ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(annPayload)) {
    if (v && typeof v === 'object' && 'scale' in (v as object)) {
      trajMarks[k] = v as Mark
    }
  }

  // Latest review event for this one annotation.
  const reviewEventRows = await db
    .select({ ts: events.ts, type: events.type, payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.workspaceId, opts.workspaceId),
        inArray(events.type, [
          'annotation.approved',
          'annotation.rejected',
          'annotation.revised',
        ]),
      ),
    )
    .orderBy(desc(events.ts))
  let reviewVerdict: ApiAnnotation['reviewVerdict'] = null
  let reviewFeedback: string | null = null
  let reviewedAt: string | null = null
  for (const r of reviewEventRows) {
    const p = (r.payload ?? {}) as Record<string, unknown>
    if (p.annotationId !== opts.annotationId) continue
    if (r.type === 'annotation.approved') reviewVerdict = 'approved'
    else if (r.type === 'annotation.rejected') reviewVerdict = 'rejected'
    else if (r.type === 'annotation.revised') reviewVerdict = 'revised'
    reviewFeedback = typeof p.feedback === 'string' ? p.feedback : null
    reviewedAt = r.ts.toISOString()
    break
  }

  return {
    id: row.id,
    trajectoryId,
    userId: row.userId,
    userEmail: row.userEmail ?? null,
    userDisplayName: row.userDisplayName ?? null,
    status: (row.topicStatus as ApiAnnotationStatus) ?? 'drafting',
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewVerdict,
    reviewFeedback,
    reviewedAt,
    trajectoryMarks: trajMarks,
    stepMarks,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function decodeStepMark(
  payload: unknown,
  legacyRating: number | null,
  legacyReasoning: string | null,
): Mark | null {
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>
    if (
      o.scale === 'likert' ||
      o.scale === 'bool' ||
      o.scale === 'enum' ||
      o.scale === 'text'
    ) {
      return o as Mark
    }
  }
  if (legacyRating === 1 || legacyRating === 3 || legacyRating === 5) {
    return {
      scale: 'likert',
      value: legacyRating,
      reason: legacyReasoning ?? undefined,
    }
  }
  return null
}
