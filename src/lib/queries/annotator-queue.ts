import 'server-only'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  stepAnnotations,
  topics,
  tasks,
  trajectories,
  trajectorySteps,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema'

/**
 * Annotator-facing queue helpers.
 *
 * Powers `/my/queue` — the daily "what should I work on next" surface for
 * annotators. Reads ONLY (no claim semantics yet; trajectories aren't
 * exclusive-locked. If two annotators open the same trajectory their
 * marks both land and the IAA path handles the consensus).
 *
 * "Available" = trajectory in a workspace I'm a member of (annotator
 * or admin) that I haven't yet submitted an annotation on. Ordering
 * blends three signals so the top of the queue is the highest-impact
 * work:
 *
 *   1. dispute density — more open disputes = higher priority (other
 *      raters disagree, my mark could break the tie)
 *   2. age — older trajectories first to clear the backlog
 *   3. step count — shorter ones first to ease the warm-up
 */

// ─── Queue listing ───────────────────────────────────────────────────────

export type QueueItem = {
  trajectoryId: string
  workspaceId: string
  workspaceName: string
  agentName: string
  rootPromptPreview: string
  stepCount: number
  createdAt: Date
  /** How many open disputes exist on this trajectory (peer raters disagree). */
  disputeCount: number
  /** True when at least one peer rater has submitted on this trajectory. */
  hasPeerMarks: boolean
  /** True when I have a draft annotation in progress on this trajectory. */
  inProgress: boolean
  /** Cached AI summary if available — lets the UI show 1-line preview. */
  summaryPreview: string | null
  /**
   * Heuristic priority bucket the UI can use for visual sorting:
   *   - 'dispute' : 1+ open disputes (red callout, top of list)
   *   - 'resume'  : I have an in-progress draft (yellow callout)
   *   - 'fresh'   : no marks yet, no peer activity (default green)
   *   - 'peer'    : peers rated but I haven't (neutral)
   */
  priority: 'dispute' | 'resume' | 'fresh' | 'peer'
}

export interface ListMyQueueOpts {
  userId: string
  /** Scope to one workspace. When omitted, queue spans every workspace the user belongs to. */
  workspaceId?: string
  limit?: number
}

export async function listMyQueueForUser(
  opts: ListMyQueueOpts,
): Promise<QueueItem[]> {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 50, 200)

  // 1. Resolve which workspaces I can pull work from. Viewers excluded —
  // they can't submit marks anyway, no point listing.
  const memberRows = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      workspaceName: workspaces.name,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, opts.userId))
  const workspaceIds = memberRows
    .filter((r) => r.role === 'admin' || r.role === 'annotator')
    .map((r) => r.workspaceId)
    .filter((id) => !opts.workspaceId || id === opts.workspaceId)
  if (workspaceIds.length === 0) return []
  const workspaceNameById = new Map(
    memberRows.map((r) => [r.workspaceId, r.workspaceName]),
  )

  // 2. Pull candidate trajectories. Newest 500 from these workspaces;
  // we'll rank + slice in JS. At MVP scale (~thousands per workspace)
  // this is fine. Promote to a SQL-side rank when it stops being.
  const candidates = await db
    .select({
      id: trajectories.id,
      workspaceId: trajectories.workspaceId,
      agentName: trajectories.agentName,
      rootPrompt: trajectories.rootPrompt,
      createdAt: trajectories.createdAt,
      summary: trajectories.summary,
    })
    .from(trajectories)
    .where(
      and(
        inArray(trajectories.workspaceId, workspaceIds),
        isNull(trajectories.deletedAt),
      ),
    )
    .orderBy(desc(trajectories.createdAt))
    .limit(500)
  if (candidates.length === 0) return []
  const candidateIds = candidates.map((c) => c.id)

  // 3. Step counts per trajectory.
  const stepCounts = await db
    .select({
      trajectoryId: trajectorySteps.trajectoryId,
      n: sql<number>`count(*)::int`,
    })
    .from(trajectorySteps)
    .where(inArray(trajectorySteps.trajectoryId, candidateIds))
    .groupBy(trajectorySteps.trajectoryId)
  const stepCountByTraj = new Map(stepCounts.map((r) => [r.trajectoryId, r.n]))

  // 4. Find which trajectories I already submitted on. Submitted = the
  // annotation row has a non-null submittedAt. Drafts (no submittedAt)
  // remain in queue as "resume" state.
  const myAnnotations = await db
    .select({
      annotationId: annotations.id,
      topicId: annotations.topicId,
      submittedAt: annotations.submittedAt,
    })
    .from(annotations)
    .where(eq(annotations.userId, opts.userId))
  const submittedAnnotationIds = new Set(
    myAnnotations.filter((a) => a.submittedAt).map((a) => a.annotationId),
  )
  const draftAnnotationIds = new Set(
    myAnnotations.filter((a) => !a.submittedAt).map((a) => a.annotationId),
  )

  // 5. Find which trajectories my annotations are bound to. Walking
  // step_annotations is the cheapest map: my annotation → step → traj.
  const myStepMarkRows =
    myAnnotations.length > 0
      ? await db
          .select({
            annotationId: stepAnnotations.annotationId,
            trajectoryId: trajectorySteps.trajectoryId,
          })
          .from(stepAnnotations)
          .innerJoin(
            trajectorySteps,
            eq(trajectorySteps.id, stepAnnotations.trajectoryStepId),
          )
          .where(
            inArray(
              stepAnnotations.annotationId,
              myAnnotations.map((a) => a.annotationId),
            ),
          )
      : []
  const submittedTrajIds = new Set<string>()
  const draftTrajIds = new Set<string>()
  for (const m of myStepMarkRows) {
    if (submittedAnnotationIds.has(m.annotationId))
      submittedTrajIds.add(m.trajectoryId)
    if (draftAnnotationIds.has(m.annotationId)) draftTrajIds.add(m.trajectoryId)
  }

  // 6. Dispute counts per trajectory (peer-rater disagreement). We use
  // a sub-query: for each trajectory, count step_annotations from non-me
  // users whose ratings spread ≥2 from each other.
  // For perf, pull all step_annotations for candidate trajectories in one go.
  const peerMarkRows = await db
    .select({
      trajectoryId: trajectorySteps.trajectoryId,
      stepId: stepAnnotations.trajectoryStepId,
      annotationId: stepAnnotations.annotationId,
      userId: annotations.userId,
      rating: stepAnnotations.rating,
      kind: stepAnnotations.kind,
    })
    .from(stepAnnotations)
    .innerJoin(annotations, eq(annotations.id, stepAnnotations.annotationId))
    .innerJoin(
      trajectorySteps,
      eq(trajectorySteps.id, stepAnnotations.trajectoryStepId),
    )
    .where(
      and(
        inArray(trajectorySteps.trajectoryId, candidateIds),
        eq(stepAnnotations.kind, 'step_quality'),
      ),
    )

  // Bucket per (trajectory, step) → collect ratings (excluding mine for
  // signal isolation but including mine for the spread calc).
  type StepBucket = { ratings: number[]; raters: Set<string> }
  const byTrajStep = new Map<string, StepBucket>()
  const peerActiveTrajIds = new Set<string>()
  for (const r of peerMarkRows) {
    if (r.rating == null) continue
    if (r.userId !== opts.userId) peerActiveTrajIds.add(r.trajectoryId)
    const key = `${r.trajectoryId}::${r.stepId}`
    const slot = byTrajStep.get(key) ?? {
      ratings: [],
      raters: new Set<string>(),
    }
    slot.ratings.push(r.rating)
    slot.raters.add(r.userId)
    byTrajStep.set(key, slot)
  }
  const disputeCountByTraj = new Map<string, number>()
  for (const [key, slot] of byTrajStep) {
    if (slot.ratings.length < 2 || slot.raters.size < 2) continue
    const min = Math.min(...slot.ratings)
    const max = Math.max(...slot.ratings)
    if (max - min < 2) continue // not disputed
    const trajectoryId = key.split('::')[0]
    disputeCountByTraj.set(
      trajectoryId,
      (disputeCountByTraj.get(trajectoryId) ?? 0) + 1,
    )
  }

  // 6.5. Active skips — suppress trajectories the user explicitly
  // skipped via the queue UI. Done as a separate event scan to avoid
  // tangling with the dispute math above.
  const { getActiveSkipsForUser } = await import('@/lib/actions/queue')
  const activeSkips = await getActiveSkipsForUser({
    userId: opts.userId,
    workspaceIds,
  }).catch(() => new Set<string>())

  // 7. Filter + rank.
  const items: QueueItem[] = []
  for (const c of candidates) {
    // Skip if I've already submitted on this trajectory.
    if (submittedTrajIds.has(c.id)) continue
    if (activeSkips.has(c.id)) continue
    const inProgress = draftTrajIds.has(c.id)
    const disputeCount = disputeCountByTraj.get(c.id) ?? 0
    const hasPeerMarks = peerActiveTrajIds.has(c.id)
    const priority: QueueItem['priority'] =
      disputeCount > 0
        ? 'dispute'
        : inProgress
          ? 'resume'
          : hasPeerMarks
            ? 'peer'
            : 'fresh'
    const summaryPreview = c.summary
      ? extractSummaryParagraph(c.summary).slice(0, 220)
      : null
    items.push({
      trajectoryId: c.id,
      workspaceId: c.workspaceId,
      workspaceName: workspaceNameById.get(c.workspaceId) ?? 'workspace',
      agentName: c.agentName,
      rootPromptPreview:
        c.rootPrompt.length > 180
          ? c.rootPrompt.slice(0, 180) + '…'
          : c.rootPrompt,
      stepCount: stepCountByTraj.get(c.id) ?? 0,
      createdAt: c.createdAt,
      disputeCount,
      hasPeerMarks,
      inProgress,
      summaryPreview,
      priority,
    })
  }

  // Final sort: dispute desc → resume → peer → fresh, tie-break by oldest first.
  const priorityRank: Record<QueueItem['priority'], number> = {
    dispute: 0,
    resume: 1,
    peer: 2,
    fresh: 3,
  }
  items.sort((a, b) => {
    const pa = priorityRank[a.priority]
    const pb = priorityRank[b.priority]
    if (pa !== pb) return pa - pb
    if (a.priority === 'dispute' && b.priority === 'dispute') {
      // More disputes first within the dispute bucket.
      if (a.disputeCount !== b.disputeCount)
        return b.disputeCount - a.disputeCount
    }
    return a.createdAt.getTime() - b.createdAt.getTime()
  })

  return items.slice(0, limit)
}

// ─── Today contribution stats ────────────────────────────────────────────

export interface QueueStats {
  /** Annotations I submitted today (local-day boundary in UTC). */
  doneToday: number
  /** Trajectories with peer disputes I helped resolve today (placeholder for now). */
  disputesBrokenToday: number
  /** Total submitted across all time. */
  doneAllTime: number
  /** In-progress drafts. */
  inProgress: number
}

export async function getMyQueueStats(opts: {
  userId: string
  workspaceId?: string
}): Promise<QueueStats> {
  const db = getDb()
  // Use events table — annotation.submitted gives us a timestamp
  // independent of any later edits. Workspace-scoped via the workspaceId
  // column on events.
  const cutoff = startOfTodayUtc()
  const conditions = [
    eq(events.type, 'annotation.submitted'),
    eq(events.actorId, opts.userId),
  ]
  if (opts.workspaceId) conditions.push(eq(events.workspaceId, opts.workspaceId))

  const rows = await db
    .select({ ts: events.ts })
    .from(events)
    .where(and(...conditions))
  const doneToday = rows.filter((r) => r.ts >= cutoff).length
  const doneAllTime = rows.length

  // Count my drafts (annotations with no submittedAt).
  const drafts = await db
    .select({ id: annotations.id })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .where(
      and(
        eq(annotations.userId, opts.userId),
        opts.workspaceId
          ? eq(tasks.workspaceId, opts.workspaceId)
          : sql`true`,
        sql`${annotations.submittedAt} is null`,
      ),
    )

  return {
    doneToday,
    doneAllTime,
    disputesBrokenToday: 0, // Placeholder — see "Future improvements" note.
    inProgress: drafts.length,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function startOfTodayUtc(): Date {
  const d = new Date()
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  )
}

/**
 * Trajectory.summary stores either plain text (legacy) or JSON wrapping
 * the canonical `{v, summary, pattern, keywords}` shape (current).
 * Extract just the paragraph for the queue preview.
 */
function extractSummaryParagraph(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith('{')) {
    try {
      const p = JSON.parse(stored)
      if (p && typeof p.summary === 'string') return p.summary
    } catch {
      /* fall through */
    }
  }
  return stored
}
