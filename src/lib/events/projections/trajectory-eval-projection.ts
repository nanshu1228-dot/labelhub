import type { Projection } from '../projector'
import type { EventBase } from '../types'

/**
 * TrajectoryEvalProjection — per-task accuracy curve for agent-trace-eval tasks.
 *
 * Folds `annotation.approved` events that carry a denormalized snapshot of the
 * annotation payload (pathChoice + finalAnswer). Output drives the
 * **"Watch Your Model Learn"** hero chart on the workspace dashboard.
 *
 * Why fold from events (instead of querying annotations directly)?
 *   - **Time-travel**: any prefix of events reproduces the curve at that point.
 *     Sliding a UI scrubber from Day 1 → Day 14 just re-folds.
 *   - **Audit**: any cell on the chart is traceable to the exact approvals
 *     that produced it.
 *
 * Bayesian smoothing keeps cold-start sensible (1/1 = 100% would be misleading).
 */

export interface TrajectoryEvalProjectionState {
  taskId: string
  totalApproved: number
  totalOptimalAndCorrect: number
  /** Bayesian-smoothed accuracy in [0, 1] */
  accuracyScore: number
  /** Time series for the chart — one point per approval event. */
  timeline: Array<{
    ts: Date
    cumulativeApproved: number
    cumulativeOptimalAndCorrect: number
    smoothedScore: number
  }>
}

const PRIOR_ALPHA = 2.5
const PRIOR_BETA = 2.5

function smoothed(positive: number, total: number): number {
  return (positive + PRIOR_ALPHA) / (total + PRIOR_ALPHA + PRIOR_BETA)
}

export function createTrajectoryEvalProjection(
  taskId: string,
): Projection<TrajectoryEvalProjectionState> {
  return {
    initial: {
      taskId,
      totalApproved: 0,
      totalOptimalAndCorrect: 0,
      accuracyScore: smoothed(0, 0), // 0.5 cold-start
      timeline: [],
    },

    apply(state, event: EventBase) {
      if (event.type !== 'annotation.approved') return state

      const p = event.payload as Record<string, unknown> | null
      if (!p || p.taskId !== taskId) return state

      // Only count agent-trace-eval annotations — others lack these fields.
      if (p.templateMode !== 'agent-trace-eval') return state

      const annPayload = p.annotationPayload as
        | { pathChoice?: string; finalAnswer?: string }
        | undefined
      if (!annPayload) return state

      const isOptimalAndCorrect =
        annPayload.pathChoice === 'optimal' &&
        annPayload.finalAnswer === 'correct'

      const totalApproved = state.totalApproved + 1
      const totalOptimalAndCorrect =
        state.totalOptimalAndCorrect + (isOptimalAndCorrect ? 1 : 0)
      const score = smoothed(totalOptimalAndCorrect, totalApproved)

      return {
        ...state,
        totalApproved,
        totalOptimalAndCorrect,
        accuracyScore: score,
        timeline: [
          ...state.timeline,
          {
            ts: event.ts,
            cumulativeApproved: totalApproved,
            cumulativeOptimalAndCorrect: totalOptimalAndCorrect,
            smoothedScore: score,
          },
        ],
      }
    },
  }
}
