import 'server-only'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  aiSubmissionVerdicts,
  annotations,
  tasks,
  topics,
  users,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema'

/**
 * Reviewer-facing queue queries — Finals P3 D11.
 *
 * The /review surface lists annotations awaiting QC / admin
 * acceptance across every workspace the signed-in user has the
 * `qc` or `admin` role in. The list joins:
 *
 *   topic  — gives status (submitted / ai_review / reviewing)
 *   annotation — the work to review
 *   task   — name + template mode (for filter)
 *   workspace — for cross-workspace queue display
 *   user   — submitter email (anonymized in UI to user.id when null)
 *   ai_submission_verdicts — most-recent verdict for AI signal
 *
 * Filters supported (via the route searchParams):
 *   - workspaceId : narrow to one workspace
 *   - stage       : 'submitted' | 'ai_review' | 'reviewing'
 *   - taskId      : narrow to one task
 *   - aiVerdict   : 'pass' | 'send_back' | 'human_review' | 'pending'
 *   - submitterId : narrow to one annotator
 */

export interface ReviewQueueFilters {
  userId: string
  workspaceId?: string
  stage?: 'submitted' | 'ai_review' | 'reviewing'
  taskId?: string
  aiVerdict?: 'pass' | 'send_back' | 'human_review' | 'pending'
  submitterId?: string
  /** Soft pagination cap — `limit` items returned per fetch. */
  limit?: number
}

export interface ReviewQueueItem {
  annotationId: string
  topicId: string
  taskId: string
  taskName: string
  workspaceId: string
  workspaceName: string
  submitterId: string | null
  submitterEmail: string | null
  status: string
  submittedAt: Date
  /** Most-recent AI verdict for this annotation, if any. */
  aiVerdict: 'pass' | 'send_back' | 'human_review' | null
  aiStatus: 'pending' | 'completed' | 'failed' | null
  aiScore: number | null
  /** Whether the verdict carries the human_review priority flag. */
  aiPriority: boolean
  /** AI reasoning for the verdict (truncated to 200 chars). */
  aiReasoning: string | null
}

/**
 * The signed-in user's role per workspace. Reviewer = QC or admin.
 * Returns an empty array when the user has no reviewable workspaces.
 */
async function listReviewableWorkspaces(
  userId: string,
): Promise<Array<{ workspaceId: string; workspaceName: string }>> {
  const db = getDb()
  const rows = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      workspaceName: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
  return rows
    .filter((r) => r.role === 'qc' || r.role === 'admin')
    .map((r) => ({
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
    }))
}

/**
 * Top-level list query. Filters down to one workspace if `workspaceId`
 * is set; otherwise spans every reviewable workspace.
 *
 * Sorts so AI-priority items (human_review verdicts) bubble to the
 * top, then submitted-at ASC (oldest first — FIFO is the polite
 * default).
 */
export async function listReviewQueue(
  filters: ReviewQueueFilters,
): Promise<ReviewQueueItem[]> {
  const db = getDb()
  const reviewable = await listReviewableWorkspaces(filters.userId)
  if (reviewable.length === 0) return []

  let allowedWsIds = reviewable.map((r) => r.workspaceId)
  if (filters.workspaceId) {
    if (!allowedWsIds.includes(filters.workspaceId)) return []
    allowedWsIds = [filters.workspaceId]
  }

  // Default stage filter — submitted + ai_review + reviewing all
  // need a reviewer's eyes. Approved / rejected are out of scope.
  const reviewableStages: Array<
    'submitted' | 'ai_review' | 'reviewing'
  > = filters.stage
    ? [filters.stage]
    : ['submitted', 'ai_review', 'reviewing']

  const conditions = [
    inArray(topics.status, reviewableStages),
    inArray(tasks.workspaceId, allowedWsIds),
  ]
  if (filters.taskId) conditions.push(eq(tasks.id, filters.taskId))
  if (filters.submitterId) {
    conditions.push(eq(annotations.userId, filters.submitterId))
  }

  // One LEFT JOIN onto the verdict row (the most-recent one per
  // annotation). We use a correlated DISTINCT ON sub-select via SQL
  // rather than Drizzle's relational API since the API doesn't
  // express "most-recent child" cleanly.
  const latestVerdictSql = sql`(
    SELECT v.id, v.status, v.verdict, v.scores, v.reasoning, v.started_at
    FROM ${aiSubmissionVerdicts} v
    WHERE v.annotation_id = ${annotations.id}
    ORDER BY v.started_at DESC
    LIMIT 1
  )`

  const rows = await db
    .select({
      annotationId: annotations.id,
      topicId: annotations.topicId,
      submitterId: annotations.userId,
      submittedAt: annotations.submittedAt,
      taskId: tasks.id,
      taskName: tasks.name,
      workspaceId: tasks.workspaceId,
      workspaceName: workspaces.name,
      submitterEmail: users.email,
      status: topics.status,
      verdictRow: latestVerdictSql,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .leftJoin(users, eq(users.id, annotations.userId))
    .where(and(...conditions))
    .orderBy(desc(annotations.submittedAt))
    .limit(filters.limit ?? 50)

  type VerdictRow = {
    id: string
    status: string
    verdict: string | null
    scores: Record<string, unknown> | null
    reasoning: string | null
    started_at: Date
  } | null

  const enriched: ReviewQueueItem[] = rows.map((r) => {
    const v = r.verdictRow as VerdictRow
    const verdictRaw = v?.verdict
    const isKnownVerdict =
      verdictRaw === 'pass' ||
      verdictRaw === 'send_back' ||
      verdictRaw === 'human_review'
    return {
      annotationId: r.annotationId,
      topicId: r.topicId,
      taskId: r.taskId,
      taskName: r.taskName,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      submitterId: r.submitterId,
      submitterEmail: r.submitterEmail,
      status: r.status,
      submittedAt: r.submittedAt ?? new Date(),
      aiVerdict: isKnownVerdict
        ? (verdictRaw as 'pass' | 'send_back' | 'human_review')
        : null,
      aiStatus: v
        ? v.status === 'pending' || v.status === 'completed' || v.status === 'failed'
          ? (v.status as 'pending' | 'completed' | 'failed')
          : null
        : null,
      aiScore:
        v?.scores && typeof v.scores === 'object'
          ? typeof (v.scores as Record<string, unknown>).__score === 'number'
            ? ((v.scores as Record<string, unknown>).__score as number)
            : null
          : null,
      aiPriority:
        v?.scores != null &&
        typeof v.scores === 'object' &&
        (v.scores as Record<string, unknown>).__priority === true,
      aiReasoning: v?.reasoning ? v.reasoning.slice(0, 200) : null,
    }
  })

  // Apply AI verdict filter in app code (the verdict comes from the
  // sub-select; doing the filter in SQL would require joining the
  // sub-select against a CTE which is more complex than needed at
  // queue scale).
  let filtered = enriched
  if (filters.aiVerdict === 'pending') {
    filtered = filtered.filter((e) => e.aiStatus === 'pending' && e.aiVerdict === null)
  } else if (filters.aiVerdict) {
    filtered = filtered.filter((e) => e.aiVerdict === filters.aiVerdict)
  }

  // Priority items first; then most-recent submissions.
  filtered.sort((a, b) => {
    if (a.aiPriority !== b.aiPriority) {
      return a.aiPriority ? -1 : 1
    }
    return b.submittedAt.getTime() - a.submittedAt.getTime()
  })

  return filtered
}

/** Tasks the reviewer can filter by — every task in their reviewable workspaces. */
export async function listReviewableTasks(
  userId: string,
): Promise<
  Array<{
    taskId: string
    taskName: string
    workspaceId: string
    workspaceName: string
  }>
> {
  const db = getDb()
  const reviewable = await listReviewableWorkspaces(userId)
  if (reviewable.length === 0) return []
  const allowedWsIds = reviewable.map((r) => r.workspaceId)
  const rows = await db
    .select({
      taskId: tasks.id,
      taskName: tasks.name,
      workspaceId: tasks.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(tasks)
    .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .where(inArray(tasks.workspaceId, allowedWsIds))
    .orderBy(asc(workspaces.name), asc(tasks.name))
  return rows
}

/**
 * Public re-export of the reviewable-workspaces helper so the page
 * can render the filter chip-row.
 */
export async function listMyReviewableWorkspaces(opts: {
  userId: string
}): Promise<Array<{ workspaceId: string; workspaceName: string }>> {
  return listReviewableWorkspaces(opts.userId)
}
