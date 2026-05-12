import type { Projection } from '../projector'
import type { EventBase } from '../types'

/**
 * TrustProjection — per-user trust score from approval/rejection history.
 *
 * Uses Bayesian smoothing (α = β = 2.5) so a new annotator starts at 0.5
 * and converges to their true rate as sample size grows. Avoids the
 * "1/1 = 100% trusted" cold-start problem of raw ratios.
 *
 * For approval/rejection events we read `payload.submitterUserId` (denormalized
 * by `reviewAnnotation` so this projection stays pure — no DB joins).
 *
 * MVP scope: global trust per user. A future variant can return
 * Record<TemplateMode, TrustProjectionState> for per-paradigm scoring.
 */

export interface TrustProjectionState {
  userId: string
  totalSubmitted: number
  totalApproved: number
  totalRejected: number
  /** Bayesian-smoothed score in [0, 1] */
  score: number
}

const PRIOR_ALPHA = 2.5
const PRIOR_BETA = 2.5

function smoothedScore(approved: number, rejected: number): number {
  return (
    (approved + PRIOR_ALPHA) /
    (approved + rejected + PRIOR_ALPHA + PRIOR_BETA)
  )
}

export function createTrustProjection(
  userId: string,
): Projection<TrustProjectionState> {
  return {
    initial: {
      userId,
      totalSubmitted: 0,
      totalApproved: 0,
      totalRejected: 0,
      score: smoothedScore(0, 0), // 0.5
    },

    apply(state, event: EventBase) {
      const p = event.payload as Record<string, unknown> | null

      if (event.type === 'annotation.submitted') {
        // The submitter IS the actor on submit events.
        if (event.actorId !== userId) return state
        return { ...state, totalSubmitted: state.totalSubmitted + 1 }
      }

      if (
        event.type === 'annotation.approved' ||
        event.type === 'annotation.rejected'
      ) {
        // Reviewer is actor; we want the submitter from denormalized payload.
        const submitterId = p?.submitterUserId as string | undefined
        if (submitterId !== userId) return state

        if (event.type === 'annotation.approved') {
          const totalApproved = state.totalApproved + 1
          return {
            ...state,
            totalApproved,
            score: smoothedScore(totalApproved, state.totalRejected),
          }
        }

        const totalRejected = state.totalRejected + 1
        return {
          ...state,
          totalRejected,
          score: smoothedScore(state.totalApproved, totalRejected),
        }
      }

      return state
    },
  }
}
