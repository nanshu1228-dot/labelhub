import 'server-only'
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
} from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  tasks,
  topics,
  trajectories,
  users,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema'

/**
 * Admin dashboard data — every workspace this user administers, with
 * the operational stats they care about: pending QC, last-week
 * approval rate, recently rejected work that might need attention.
 *
 * This is the cross-workspace cockpit. /workspaces/[id] is single-
 * workspace operations; /admin is the bird's-eye view across all of
 * an admin's workspaces.
 *
 * Caller is responsible for confirming the user is signed in. Workspace-
 * membership filtering happens here.
 */

export interface AdminWorkspaceCard {
  workspaceId: string
  name: string
  templateMode: string
  /** Topics with annotations awaiting QC pass or admin acceptance. */
  pendingReview: number
  /** Approved annotations in the last 7 days. */
  approvedLast7d: number
  /** Rejected in the last 7 days — admin attention. */
  rejectedLast7d: number
  /** Topics with status='revising' (打回) — annotator owes a redo. */
  awaitingRevision: number
  /** Last activity event timestamp (any event). */
  lastActivityAt: Date | null
}

export interface AdminPendingItem {
  annotationId: string
  topicId: string
  workspaceId: string
  workspaceName: string
  taskId: string
  taskName: string
  templateMode: string
  topicStatus: string
  submitterDisplayName: string | null
  submittedAt: Date | null
}

export interface AdminDashboardData {
  cards: AdminWorkspaceCard[]
  /** Pending items across ALL workspaces, sorted oldest-first (FIFO). */
  pendingAcrossAll: AdminPendingItem[]
  /** Recently rejected annotations admin might want to inspect. */
  recentlyRejected: AdminPendingItem[]
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function getAdminDashboardData(opts: {
  userId: string
}): Promise<AdminDashboardData> {
  const db = getDb()

  // 1. Find every workspace where the viewer has admin role.
  //    Includes the legacy `workspaces.admin_id === userId` fallback for
  //    workspaces created before the workspace_members rollout.
  const memberRows = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      workspaceName: workspaces.name,
      workspaceTemplateMode: workspaces.templateMode,
      adminId: workspaces.adminId,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, opts.userId))

  const adminWorkspaces = memberRows.filter(
    (r) => r.role === 'admin' || r.adminId === opts.userId,
  )
  if (adminWorkspaces.length === 0) {
    return { cards: [], pendingAcrossAll: [], recentlyRejected: [] }
  }
  const workspaceIds = adminWorkspaces.map((r) => r.workspaceId)
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS)

  // 2. Parallel counts per workspace.
  const cardData = await Promise.all(
    adminWorkspaces.map(async (ws) => {
      const [
        [pendingRow],
        [approvedRow],
        [rejectedRow],
        [revisingRow],
        [lastEvtRow],
      ] = await Promise.all([
        // Submitted + reviewing + awaiting_acceptance = "needs admin/QC eyes"
        db
          .select({ n: count() })
          .from(annotations)
          .innerJoin(topics, eq(topics.id, annotations.topicId))
          .innerJoin(tasks, eq(tasks.id, topics.taskId))
          .where(
            and(
              eq(tasks.workspaceId, ws.workspaceId),
              isNotNull(annotations.submittedAt),
              inArray(topics.status, [
                'submitted',
                'reviewing',
                'awaiting_acceptance',
              ]),
            ),
          ),
        db
          .select({ n: count() })
          .from(events)
          .where(
            and(
              eq(events.workspaceId, ws.workspaceId),
              eq(events.type, 'annotation.approved'),
              gte(events.ts, sevenDaysAgo),
            ),
          ),
        db
          .select({ n: count() })
          .from(events)
          .where(
            and(
              eq(events.workspaceId, ws.workspaceId),
              eq(events.type, 'annotation.rejected'),
              gte(events.ts, sevenDaysAgo),
            ),
          ),
        db
          .select({ n: count() })
          .from(topics)
          .innerJoin(tasks, eq(tasks.id, topics.taskId))
          .where(
            and(
              eq(tasks.workspaceId, ws.workspaceId),
              eq(topics.status, 'revising'),
            ),
          ),
        db
          .select({ ts: events.ts })
          .from(events)
          .where(eq(events.workspaceId, ws.workspaceId))
          .orderBy(desc(events.ts))
          .limit(1),
      ])
      return {
        workspaceId: ws.workspaceId,
        name: ws.workspaceName,
        templateMode: ws.workspaceTemplateMode,
        pendingReview: pendingRow?.n ?? 0,
        approvedLast7d: approvedRow?.n ?? 0,
        rejectedLast7d: rejectedRow?.n ?? 0,
        awaitingRevision: revisingRow?.n ?? 0,
        lastActivityAt: lastEvtRow?.ts ?? null,
      }
    }),
  )

  // 3. Cross-workspace pending queue — submitted/reviewing/awaiting,
  // sorted oldest first so the most-delayed work surfaces top.
  const pendingRaw = await db
    .select({
      annotationId: annotations.id,
      topicId: annotations.topicId,
      workspaceId: tasks.workspaceId,
      taskId: tasks.id,
      taskName: tasks.name,
      templateMode: tasks.templateMode,
      topicStatus: topics.status,
      submitterDisplayName: users.displayName,
      submittedAt: annotations.submittedAt,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .innerJoin(users, eq(users.id, annotations.userId))
    .where(
      and(
        inArray(tasks.workspaceId, workspaceIds),
        isNotNull(annotations.submittedAt),
        inArray(topics.status, [
          'submitted',
          'reviewing',
          'awaiting_acceptance',
        ]),
      ),
    )
    .orderBy(annotations.submittedAt) // oldest first
    .limit(20)

  const nameById = new Map(
    adminWorkspaces.map((w) => [w.workspaceId, w.workspaceName]),
  )
  const pendingAcrossAll: AdminPendingItem[] = pendingRaw.map((r) => ({
    annotationId: r.annotationId,
    topicId: r.topicId,
    workspaceId: r.workspaceId,
    workspaceName: nameById.get(r.workspaceId) ?? '',
    taskId: r.taskId,
    taskName: r.taskName,
    templateMode: r.templateMode,
    topicStatus: r.topicStatus,
    submitterDisplayName: r.submitterDisplayName ?? null,
    submittedAt: r.submittedAt ?? null,
  }))

  // 4. Recently rejected — last 14 days, joined back to annotation+task
  // so admin can click through. We pull from events because the topic
  // status alone is final ('rejected') but doesn't carry timestamps
  // for "when did this transition happen".
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const rejectedEvents = await db
    .select({
      payload: events.payload,
      ts: events.ts,
      workspaceId: events.workspaceId,
    })
    .from(events)
    .where(
      and(
        inArray(events.workspaceId, workspaceIds),
        eq(events.type, 'annotation.rejected'),
        gte(events.ts, fourteenDaysAgo),
      ),
    )
    .orderBy(desc(events.ts))
    .limit(20)

  // Resolve annotation rows for the rejected event ids.
  const rejectedAnnIds = rejectedEvents
    .map((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>
      return typeof p.annotationId === 'string' ? p.annotationId : null
    })
    .filter((x): x is string => x !== null)
  let recentlyRejected: AdminPendingItem[] = []
  if (rejectedAnnIds.length > 0) {
    const annRows = await db
      .select({
        annotationId: annotations.id,
        topicId: annotations.topicId,
        workspaceId: tasks.workspaceId,
        taskId: tasks.id,
        taskName: tasks.name,
        templateMode: tasks.templateMode,
        topicStatus: topics.status,
        submitterDisplayName: users.displayName,
        submittedAt: annotations.submittedAt,
      })
      .from(annotations)
      .innerJoin(topics, eq(topics.id, annotations.topicId))
      .innerJoin(tasks, eq(tasks.id, topics.taskId))
      .innerJoin(users, eq(users.id, annotations.userId))
      .where(inArray(annotations.id, rejectedAnnIds))
    recentlyRejected = annRows.map((r) => ({
      annotationId: r.annotationId,
      topicId: r.topicId,
      workspaceId: r.workspaceId,
      workspaceName: nameById.get(r.workspaceId) ?? '',
      taskId: r.taskId,
      taskName: r.taskName,
      templateMode: r.templateMode,
      topicStatus: r.topicStatus,
      submitterDisplayName: r.submitterDisplayName ?? null,
      submittedAt: r.submittedAt ?? null,
    }))
  }

  // Sort cards by pending count desc — surface the busiest workspace.
  cardData.sort((a, b) => b.pendingReview - a.pendingReview)

  return {
    cards: cardData,
    pendingAcrossAll,
    recentlyRejected,
  }
}

/**
 * Cheap check: is this user an admin of any workspace? Used by the
 * header / account page to decide whether to surface the /admin nav
 * entry.
 */
export async function userAdminsAnyWorkspace(userId: string): Promise<boolean> {
  const db = getDb()
  const [row] = await db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .limit(50)
  if (row) {
    // Faster path: any membership with role=admin counts. We need to
    // check the role, so re-fetch.
    const adminRow = await db
      .select({ id: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.role, 'admin'),
        ),
      )
      .limit(1)
    if (adminRow.length > 0) return true
  }
  // Legacy fallback — any workspace where they're the original admin_id.
  const [legacy] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.adminId, userId))
    .limit(1)
  return !!legacy
}

// Silence unused-imports until trajectories is needed for a per-mode card
void trajectories
