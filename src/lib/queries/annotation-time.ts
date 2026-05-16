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
 *   1. `annotation.durationSec` — set at submit time from the
 *      `startedAt` anchor. Works for ALL modes (pair-rubric / arena-gsb /
 *      agent-trace-eval).
 *   2. `annotation.startedAt` → `annotation.submittedAt` — same idea
 *      but computed on the fly (useful when an old draft's
 *      durationSec is null but startedAt is set).
 *   3. Falls back to first `step_annotation.createdAt` →
 *      `annotation.submittedAt` for legacy trajectory rows that
 *      predate the started_at column.
 *
 * Returns null `elapsedSeconds` when none of those apply.
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
      startedAt: annotations.startedAt,
      durationSec: annotations.durationSec,
      topicId: annotations.topicId,
    })
    .from(annotations)
    .where(eq(annotations.id, annotationId))
    .limit(1)
  if (!ann) return null

  // Fast path: row already has durationSec persisted from submit time
  // (this is the post-tracking-rollout case for every mode).
  if (ann.durationSec != null) {
    const submittedAt = ann.submittedAt ?? null
    return {
      annotationId,
      startedAt: ann.startedAt,
      submittedAt,
      elapsedSeconds: ann.durationSec,
      flag: await classifyForTopic(ann.topicId, ann.durationSec),
    }
  }

  // Medium path: startedAt was anchored on draft save but durationSec
  // wasn't persisted (interrupted submit, or older code path). Derive
  // from the timestamp pair.
  if (ann.startedAt && ann.submittedAt) {
    const elapsedSeconds = Math.max(
      0,
      Math.round((ann.submittedAt.getTime() - ann.startedAt.getTime()) / 1000),
    )
    return {
      annotationId,
      startedAt: ann.startedAt,
      submittedAt: ann.submittedAt,
      elapsedSeconds,
      flag: await classifyForTopic(ann.topicId, elapsedSeconds),
    }
  }

  // Slow path / legacy: trajectory rows from before started_at landed.
  // Use the first step-annotation timestamp as the start signal.
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

/**
 * Resolve the task's economy config for a topic, then classify the
 * elapsed seconds. Used by the fast-path (durationSec already
 * persisted) where we don't need to re-derive the timestamp pair
 * but still want the same flag semantics.
 */
async function classifyForTopic(
  topicId: string,
  elapsedSeconds: number,
): Promise<'fast' | 'slow' | 'ok' | null> {
  const db = getDb()
  const [topic] = await db
    .select({ taskId: topics.taskId })
    .from(topics)
    .where(eq(topics.id, topicId))
    .limit(1)
  if (!topic) return null
  const [task] = await db
    .select({ rewardConfig: tasks.rewardConfig })
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)
  const parsed = economyConfigSchema.safeParse(task?.rewardConfig ?? null)
  return parsed.success ? classify(elapsedSeconds, parsed.data) : 'ok'
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

  // Pull every submitted annotation in the workspace. Also pull
  // startedAt + durationSec so the modern fast-path can short-circuit
  // the step-mark fallback below.
  const annRows = await db
    .select({
      annotationId: annotations.id,
      submittedAt: annotations.submittedAt,
      startedAt: annotations.startedAt,
      durationSec: annotations.durationSec,
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
    // Three-tier source priority (matches getAnnotationTime):
    //   1. durationSec column — direct read, all modes
    //   2. startedAt → submittedAt pair — derive on the fly
    //   3. first step_annotation.createdAt — legacy trajectory fallback
    const firstMark = firstMarkByAnnotation.get(r.annotationId)
    let elapsedSeconds: number | null = null
    if (r.durationSec != null) {
      elapsedSeconds = r.durationSec
    } else if (r.startedAt && r.submittedAt) {
      elapsedSeconds = Math.max(
        0,
        Math.round(
          (r.submittedAt.getTime() - r.startedAt.getTime()) / 1000,
        ),
      )
    } else if (firstMark && r.submittedAt) {
      elapsedSeconds = Math.max(
        0,
        Math.round(
          (r.submittedAt.getTime() - firstMark.createdAt.getTime()) / 1000,
        ),
      )
    }

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
