import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  stepAnnotations,
  tasks,
  topics,
  trajectorySteps,
  trajectories,
  users,
} from '@/lib/db/schema'
import {
  economyConfigSchema,
  type EconomyConfig,
} from '@/lib/templates/types'

/**
 * Wall-clock elapsed time for annotations — admin's "did this rater
 * speed-skip or get stuck?" view.
 *
 * Source of truth (in order of preference):
 *   1. `annotation.created_at` from the events table (when `annotation.drafted`
 *      or first step mark landed) → `annotation.submittedAt`
 *   2. Falls back to first step_annotation timestamp when event row is missing
 *
 * Returns null `elapsedSeconds` when we can't compute it (submitter never
 * actually finished, or the annotation row predates the event-sourced flow).
 *
 * **Not** "active time" — we deliberately don't track keystroke heartbeats.
 * Wall-clock is sufficient signal for the speed-skip / time-fraud narratives
 * without the overhead of client-side tracking. If admins want more, the
 * events log already captures per-mark timestamps and they can derive.
 */

export interface AnnotationTime {
  annotationId: string
  /** Earliest known timestamp: first step mark or annotation row creation. */
  startedAt: Date | null
  /** annotation.submitted_at, or null if still in flight. */
  submittedAt: Date | null
  /** submittedAt - startedAt, in seconds. Null when either is unknown. */
  elapsedSeconds: number | null
  /** Flagged 'fast' when below minExpectedSeconds, 'slow' when above maxBillableSeconds. */
  flag: 'fast' | 'slow' | 'ok' | null
}

/**
 * Compute elapsed time for one annotation. Uses the earliest step_annotation
 * row as a proxy for "started" — the annotations row itself doesn't track
 * createdAt, so we infer from the first piece of actual work.
 */
export async function getAnnotationTime(
  annotationId: string,
): Promise<AnnotationTime | null> {
  const db = getDb()
  const [ann] = await db
    .select({
      id: annotations.id,
      submittedAt: annotations.submittedAt,
      topicId: annotations.topicId,
    })
    .from(annotations)
    .where(eq(annotations.id, annotationId))
    .limit(1)
  if (!ann) return null

  // Earliest step mark created_at as start signal.
  const [firstMark] = await db
    .select({ createdAt: stepAnnotations.createdAt })
    .from(stepAnnotations)
    .where(eq(stepAnnotations.annotationId, annotationId))
    .orderBy(stepAnnotations.createdAt)
    .limit(1)

  const startedAt = firstMark?.createdAt ?? null
  const submittedAt = ann.submittedAt ?? null
  const elapsedSeconds =
    startedAt && submittedAt
      ? Math.max(0, Math.round((submittedAt.getTime() - startedAt.getTime()) / 1000))
      : null

  // Lookup the task's economy thresholds for flag classification.
  let flag: AnnotationTime['flag'] = null
  if (elapsedSeconds != null) {
    const [topic] = await db
      .select({ taskId: topics.taskId })
      .from(topics)
      .where(eq(topics.id, ann.topicId))
      .limit(1)
    if (topic) {
      const [task] = await db
        .select({ rewardConfig: tasks.rewardConfig })
        .from(tasks)
        .where(eq(tasks.id, topic.taskId))
        .limit(1)
      const parsed = economyConfigSchema.safeParse(task?.rewardConfig ?? null)
      if (parsed.success) {
        flag = classify(elapsedSeconds, parsed.data)
      }
    }
  }

  return {
    annotationId,
    startedAt,
    submittedAt,
    elapsedSeconds,
    flag,
  }
}

function classify(
  elapsedSeconds: number,
  economy: EconomyConfig,
): 'fast' | 'slow' | 'ok' {
  if (
    economy.minExpectedSeconds &&
    elapsedSeconds < economy.minExpectedSeconds
  ) {
    return 'fast'
  }
  if (
    economy.maxBillableSeconds &&
    elapsedSeconds > economy.maxBillableSeconds
  ) {
    return 'slow'
  }
  return 'ok'
}

// ─── Bulk view — Quality page ────────────────────────────────────────────

export interface AnnotationTimeRow {
  annotationId: string
  raterId: string
  raterDisplayName: string | null
  trajectoryId: string | null
  trajectoryAgentName: string | null
  elapsedSeconds: number | null
  flag: 'fast' | 'slow' | 'ok' | null
}

/**
 * Per-annotation elapsed-time table for an admin's quality dashboard.
 *
 * Returns one row per submitted annotation in the workspace, sorted by
 * elapsed time descending (longest first — most likely to be idle-fraud).
 * Unsubmitted drafts are filtered out (no signal).
 */
export async function listWorkspaceAnnotationTimes(
  workspaceId: string,
): Promise<AnnotationTimeRow[]> {
  const db = getDb()

  // Pull every submitted annotation in the workspace.
  const annRows = await db
    .select({
      annotationId: annotations.id,
      submittedAt: annotations.submittedAt,
      userId: annotations.userId,
      displayName: users.displayName,
      taskRewardConfig: tasks.rewardConfig,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .innerJoin(users, eq(users.id, annotations.userId))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        sql`${annotations.submittedAt} is not null`,
      ),
    )

  if (annRows.length === 0) return []

  // Earliest step mark per annotation (one query, then bucket by annotationId).
  const annotationIds = annRows.map((r) => r.annotationId)
  const stepMarkRows = await db
    .select({
      annotationId: stepAnnotations.annotationId,
      createdAt: stepAnnotations.createdAt,
      trajectoryId: trajectorySteps.trajectoryId,
      trajectoryAgentName: trajectories.agentName,
    })
    .from(stepAnnotations)
    .innerJoin(
      trajectorySteps,
      eq(trajectorySteps.id, stepAnnotations.trajectoryStepId),
    )
    .innerJoin(
      trajectories,
      eq(trajectories.id, trajectorySteps.trajectoryId),
    )
    .where(inArray(stepAnnotations.annotationId, annotationIds))

  const firstMarkByAnnotation = new Map<
    string,
    { createdAt: Date; trajectoryId: string; trajectoryAgentName: string }
  >()
  for (const sm of stepMarkRows) {
    const existing = firstMarkByAnnotation.get(sm.annotationId)
    if (!existing || sm.createdAt < existing.createdAt) {
      firstMarkByAnnotation.set(sm.annotationId, {
        createdAt: sm.createdAt,
        trajectoryId: sm.trajectoryId,
        trajectoryAgentName: sm.trajectoryAgentName,
      })
    }
  }

  const out: AnnotationTimeRow[] = annRows.map((r) => {
    const firstMark = firstMarkByAnnotation.get(r.annotationId)
    const elapsedSeconds =
      firstMark && r.submittedAt
        ? Math.max(
            0,
            Math.round(
              (r.submittedAt.getTime() - firstMark.createdAt.getTime()) / 1000,
            ),
          )
        : null

    let flag: 'fast' | 'slow' | 'ok' | null = null
    if (elapsedSeconds != null) {
      const parsed = economyConfigSchema.safeParse(r.taskRewardConfig)
      if (parsed.success) {
        flag = classify(elapsedSeconds, parsed.data)
      } else {
        flag = 'ok'
      }
    }

    return {
      annotationId: r.annotationId,
      raterId: r.userId,
      raterDisplayName: r.displayName,
      trajectoryId: firstMark?.trajectoryId ?? null,
      trajectoryAgentName: firstMark?.trajectoryAgentName ?? null,
      elapsedSeconds,
      flag,
    }
  })

  // Sort: flagged-slow first, then flagged-fast, then by elapsed desc.
  out.sort((a, b) => {
    const flagRank = (f: typeof a.flag) =>
      f === 'slow' ? 0 : f === 'fast' ? 1 : 2
    const fa = flagRank(a.flag)
    const fb = flagRank(b.flag)
    if (fa !== fb) return fa - fb
    return (b.elapsedSeconds ?? 0) - (a.elapsedSeconds ?? 0)
  })
  return out
}

// ─── Display helper ──────────────────────────────────────────────────────

/**
 * Render seconds as a compact "12m 30s" / "1h 5m" string for table cells.
 */
export function formatElapsed(seconds: number | null): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return `${h}h ${remM.toString().padStart(2, '0')}m`
}
