import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  stepAnnotations,
  tasks,
  topics,
  trajectories,
  trajectorySteps,
  users,
} from '@/lib/db/schema'
import { getTemplate } from '@/lib/templates/registry'
import '@/lib/templates/init'
import type { Mark, RubricItem } from '@/lib/templates/rubric'
import type { TemplateMode } from '@/lib/templates/types'

/**
 * Critical-rubric violations across a workspace — admin operational view.
 *
 * A "violation" is when an annotator marked a `severity: 'critical'` rubric
 * with the worst-possible value:
 *   - likert: value === 1
 *   - bool  : value === false (convention: true = safe, false = violated)
 *   - enum  : value === last option (conventionally the worst)
 *   - text  : never (no machine-judgeable violation)
 *
 * A single critical violation is the closest LabelHub gets to Xpert's
 * "雷区 −999" mechanic — it vetoes the trajectory's overall quality
 * without requiring the calibration math.
 */

export interface CriticalViolation {
  trajectoryId: string
  trajectoryAgentName: string
  rubricId: string
  rubricName: string
  /** 'step' or 'trajectory' — where the violating mark lives. */
  level: 'step' | 'trajectory'
  /** Step that the violation is attached to (null when level === 'trajectory'). */
  stepId: string | null
  /** Rater who raised the flag. */
  raterId: string
  raterDisplayName: string | null
  /** When the violating mark was created/last touched. */
  ts: Date
}

/**
 * Scan a workspace for critical-rubric violations.
 *
 * Approach: load every annotation in the workspace, derive each task's
 * template rubric, find the critical-severity items, then check the
 * stored Mark values for the worst-case. This is O(annotations × rubrics)
 * but rubrics are tiny (~10) and annotations per workspace are bounded
 * at MVP scale — fine for the Quality page TTI budget.
 */
export async function listWorkspaceCriticalViolations(
  workspaceId: string,
): Promise<CriticalViolation[]> {
  const db = getDb()

  // Pull every annotation in the workspace, along with the task + template
  // mode so we know which rubric to apply.
  const annotRows = await db
    .select({
      annotationId: annotations.id,
      annotationPayload: annotations.payload,
      userId: annotations.userId,
      displayName: users.displayName,
      submittedAt: annotations.submittedAt,
      taskTemplateMode: tasks.templateMode,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .innerJoin(users, eq(users.id, annotations.userId))
    .where(eq(tasks.workspaceId, workspaceId))

  if (annotRows.length === 0) return []

  // Pull all step marks belonging to those annotations, with the trajectory
  // they sit on so we can attribute violations.
  const stepMarkRows = await db
    .select({
      annotationId: stepAnnotations.annotationId,
      trajectoryStepId: stepAnnotations.trajectoryStepId,
      kind: stepAnnotations.kind,
      rating: stepAnnotations.rating,
      payload: stepAnnotations.payload,
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
      and(
        eq(trajectories.id, trajectorySteps.trajectoryId),
        eq(trajectories.workspaceId, workspaceId),
        isNull(trajectories.deletedAt),
      ),
    )

  // We also need to know which trajectory each annotation is anchored to
  // for trajectory-level marks. Use the step marks as the linker — every
  // annotation that has trajectory marks ALSO has step marks (in practice).
  const trajectoryByAnnotation = new Map<
    string,
    { id: string; agentName: string }
  >()
  for (const sm of stepMarkRows) {
    trajectoryByAnnotation.set(sm.annotationId, {
      id: sm.trajectoryId,
      agentName: sm.trajectoryAgentName,
    })
  }

  const out: CriticalViolation[] = []

  for (const ann of annotRows) {
    const template = getTemplate(ann.taskTemplateMode as TemplateMode)
    if (!template?.rubric) continue

    // Build a lookup of critical rubrics (per-step + per-trajectory).
    const criticalStepRubrics = new Map<string, RubricItem>()
    for (const item of template.rubric.perStep) {
      if (item.severity === 'critical') criticalStepRubrics.set(item.id, item)
    }
    const criticalTrajectoryRubrics = new Map<string, RubricItem>()
    for (const item of template.rubric.perTrajectory) {
      if (item.severity === 'critical') {
        criticalTrajectoryRubrics.set(item.id, item)
      }
    }
    if (
      criticalStepRubrics.size === 0 &&
      criticalTrajectoryRubrics.size === 0
    ) {
      continue
    }

    // ── Step-level violations ────────────────────────────────────────
    if (criticalStepRubrics.size > 0) {
      const myStepMarks = stepMarkRows.filter(
        (sm) => sm.annotationId === ann.annotationId,
      )
      for (const sm of myStepMarks) {
        const rubric = criticalStepRubrics.get(sm.kind)
        if (!rubric) continue
        const mark = (sm.payload ?? null) as Mark | null
        const violated = isViolation(rubric, mark, sm.rating)
        if (!violated) continue
        out.push({
          trajectoryId: sm.trajectoryId,
          trajectoryAgentName: sm.trajectoryAgentName,
          rubricId: rubric.id,
          rubricName: rubric.name,
          level: 'step',
          stepId: sm.trajectoryStepId,
          raterId: ann.userId,
          raterDisplayName: ann.displayName,
          ts: ann.submittedAt ?? new Date(0),
        })
      }
    }

    // ── Trajectory-level violations ──────────────────────────────────
    if (criticalTrajectoryRubrics.size > 0) {
      const traj = trajectoryByAnnotation.get(ann.annotationId)
      if (!traj) continue // annotation with no associated trajectory marks
      const payload = (ann.annotationPayload ?? {}) as Record<string, unknown>
      for (const [rubricId, rubric] of criticalTrajectoryRubrics) {
        const raw = payload[rubricId]
        if (!raw || typeof raw !== 'object' || !('scale' in raw)) continue
        const mark = raw as Mark
        if (!isViolation(rubric, mark, null)) continue
        out.push({
          trajectoryId: traj.id,
          trajectoryAgentName: traj.agentName,
          rubricId: rubric.id,
          rubricName: rubric.name,
          level: 'trajectory',
          stepId: null,
          raterId: ann.userId,
          raterDisplayName: ann.displayName,
          ts: ann.submittedAt ?? new Date(0),
        })
      }
    }
  }

  // Most recent first.
  out.sort((a, b) => b.ts.getTime() - a.ts.getTime())
  return out
}

/**
 * Was this mark a worst-case rating for the given rubric?
 *
 * For step marks we accept the optional `legacyRating` (the int column on
 * step_annotations) so old rows with no jsonb payload still trigger.
 */
function isViolation(
  rubric: RubricItem,
  mark: Mark | null,
  legacyRating: number | null,
): boolean {
  // Prefer payload, fall back to legacy rating column.
  if (mark) {
    if (mark.scale === 'likert') return mark.value === 1
    if (mark.scale === 'bool') return mark.value === false
    if (mark.scale === 'enum') {
      // Worst option = last in the declared list (convention).
      if (!rubric.options || rubric.options.length === 0) return false
      return mark.value === rubric.options[rubric.options.length - 1]
    }
    return false
  }
  if (legacyRating === 1 && rubric.scale === 'likert') return true
  return false
}
