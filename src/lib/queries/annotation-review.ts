import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { readTaskOperationalSettings } from '@/lib/tasks/settings'
import {
  annotations,
  stepAnnotations,
  tasks,
  topics,
  trajectories,
  trajectorySteps,
  users,
} from '@/lib/db/schema'

/**
 * Per-annotation read helpers for the review flow.
 *
 * The trajectory detail page can be opened in two modes:
 *   1. Normal:  no query param. Shows the viewer's own marks. Used for
 *               browsing and inline rating.
 *   2. Review:  `?annotationId=...`. Shows a SPECIFIC submitter's marks
 *               so QC/admin can render their verdict against the actual
 *               annotation under review.
 *
 * The queries here power mode 2. Workspace boundary verified at the
 * query layer — caller passes the URL workspaceId and we reject any
 * annotation that doesn't live there.
 */

export interface AnnotationReviewContext {
  annotationId: string
  /** Trajectory this annotation is bound to (resolved via step marks). */
  trajectoryId: string | null
  submitterId: string
  submitterEmail: string | null
  submitterDisplayName: string | null
  submittedAt: Date | null
  /** Topic status drives which verdict buttons render. */
  topicStatus:
    | 'drafting'
    | 'revising'
    | 'submitted'
    | 'reviewing'
    | 'awaiting_acceptance'
    | 'approved'
    | 'rejected'
  /**
   * Task-level two-stage review policy (spec §9.3). When true the admin
   * accept button must not render before QC 初审 — the server action
   * enforces it; this lets the UI hide the illegal button up front.
   */
  twoStageReview: boolean
}

/**
 * Resolve the annotation + submitter info + current topic state for
 * review mode. Returns null when the annotation doesn't exist or its
 * task lives in a different workspace.
 */
export async function getAnnotationReviewContext(opts: {
  annotationId: string
  workspaceId: string
}): Promise<AnnotationReviewContext | null> {
  const db = getDb()
  const [row] = await db
    .select({
      annotationId: annotations.id,
      submitterId: annotations.userId,
      submitterEmail: users.email,
      submitterDisplayName: users.displayName,
      submittedAt: annotations.submittedAt,
      topicStatus: topics.status,
      taskWorkspaceId: tasks.workspaceId,
      taskTemplateConfig: tasks.templateConfig,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .innerJoin(users, eq(users.id, annotations.userId))
    .where(eq(annotations.id, opts.annotationId))
    .limit(1)
  if (!row) return null
  if (row.taskWorkspaceId !== opts.workspaceId) return null

  // Trajectory linkage — derived from any step_annotation row pointing
  // back through trajectory_steps. Cheap because we LIMIT 1.
  const [tjRow] = await db
    .select({ trajectoryId: trajectorySteps.trajectoryId })
    .from(stepAnnotations)
    .innerJoin(
      trajectorySteps,
      eq(trajectorySteps.id, stepAnnotations.trajectoryStepId),
    )
    .innerJoin(
      trajectories,
      and(
        eq(trajectories.id, trajectorySteps.trajectoryId),
        eq(trajectories.workspaceId, opts.workspaceId),
        isNull(trajectories.deletedAt),
      ),
    )
    .where(eq(stepAnnotations.annotationId, opts.annotationId))
    .limit(1)

  return {
    annotationId: row.annotationId,
    trajectoryId: tjRow?.trajectoryId ?? null,
    submitterId: row.submitterId,
    submitterEmail: row.submitterEmail ?? null,
    submitterDisplayName: row.submitterDisplayName ?? null,
    submittedAt: row.submittedAt ?? null,
    topicStatus: row.topicStatus as AnnotationReviewContext['topicStatus'],
    twoStageReview: readTaskOperationalSettings(row.taskTemplateConfig)
      .twoStageReview,
  }
}

/**
 * Step marks for ONE specific annotation, keyed by trajectoryStepId.
 *
 * Returns the same shape as `listMyStepMarksInline` so the trajectory
 * detail page can swap data sources without changing downstream
 * components. Workspace boundary enforced at the query layer.
 */
export async function getStepMarksForAnnotation(opts: {
  annotationId: string
  workspaceId: string
}): Promise<Record<string, typeof stepAnnotations.$inferSelect>> {
  const db = getDb()

  // Verify the annotation lives in this workspace before exposing its
  // marks. Same defense the review-context helper above uses.
  const [boundary] = await db
    .select({ taskWorkspaceId: tasks.workspaceId })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .where(eq(annotations.id, opts.annotationId))
    .limit(1)
  if (!boundary || boundary.taskWorkspaceId !== opts.workspaceId) {
    return {}
  }

  const rows = await db
    .select()
    .from(stepAnnotations)
    .where(eq(stepAnnotations.annotationId, opts.annotationId))

  // One row per (annotationId, trajectoryStepId, kind). For the inline
  // single-likert legacy widget we collapse to one row per step,
  // preferring the step_quality kind to match the existing reader's
  // semantics. The future multi-rubric annotator reads `payload`
  // directly via a different path; this helper feeds the legacy widget.
  const out: Record<string, typeof stepAnnotations.$inferSelect> = {}
  for (const r of rows) {
    const prev = out[r.trajectoryStepId]
    if (!prev || (r.kind === 'step_quality' && prev.kind !== 'step_quality')) {
      out[r.trajectoryStepId] = r
    }
  }
  return out
}
