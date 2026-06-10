import type { Projection } from '../projector'
import type { EventBase } from '../types'
import type { WorkflowStage } from '@/lib/templates/types'

/**
 * TaskProjection — folds events into the current state of a single task.
 *
 * Pure function: same event log → same state. Replay-safe for time-travel
 * (just fold a prefix of events up to a given timestamp).
 */

export interface TaskProjectionState {
  taskId: string
  taskName: string | null
  status: 'unknown' | 'draft' | 'open' | 'paused' | 'closed' | 'archived'
  createdAt: Date | null
  publishedAt: Date | null
  pausedAt: Date | null
  closedAt: Date | null
  archivedAt: Date | null
  /** Per-topic latest stage (used to compute transitions correctly) */
  topicStates: Record<string, WorkflowStage>
  /** Aggregate counts by stage — derived from topicStates */
  topicCounts: Record<WorkflowStage, number>
}

function emptyCounts(): Record<WorkflowStage, number> {
  return {
    drafting: 0,
    revising: 0,
    submitted: 0,
    ai_review: 0,
    reviewing: 0,
    awaiting_acceptance: 0,
    approved: 0,
    rejected: 0,
  }
}

function transition(
  state: TaskProjectionState,
  topicId: string,
  nextStage: WorkflowStage,
): TaskProjectionState {
  const prev = state.topicStates[topicId]
  const counts = { ...state.topicCounts }
  if (prev) counts[prev] = Math.max(0, counts[prev] - 1)
  counts[nextStage] = counts[nextStage] + 1
  return {
    ...state,
    topicStates: { ...state.topicStates, [topicId]: nextStage },
    topicCounts: counts,
  }
}

export function createTaskProjection(
  taskId: string,
): Projection<TaskProjectionState> {
  return {
    initial: {
      taskId,
      taskName: null,
      status: 'unknown',
      createdAt: null,
      publishedAt: null,
      pausedAt: null,
      closedAt: null,
      archivedAt: null,
      topicStates: {},
      topicCounts: emptyCounts(),
    },

    apply(state, event: EventBase) {
      const p = event.payload as Record<string, unknown> | null
      const evtTaskId = (p?.taskId as string | undefined) ?? undefined
      const evtTopicId = (p?.topicId as string | undefined) ?? undefined

      // Scope filter: ignore events that belong to other tasks.
      // We can only ignore when the event has a taskId payload field; otherwise,
      // we treat it as not-for-us only when the event type is task-scoped.
      if (evtTaskId && evtTaskId !== taskId) return state

      switch (event.type) {
        case 'task.created':
          if (evtTaskId !== taskId) return state
          return {
            ...state,
            status: 'draft',
            createdAt: event.ts,
            taskName: (p?.name as string | null) ?? null,
          }

        case 'task.published':
          return { ...state, status: 'open', publishedAt: event.ts }

        case 'task.paused':
          return { ...state, status: 'paused', pausedAt: event.ts }

        case 'task.resumed':
          return { ...state, status: 'open' }

        case 'task.closed':
          return { ...state, status: 'closed', closedAt: event.ts }

        case 'task.archived':
          return { ...state, status: 'archived', archivedAt: event.ts }

        case 'topic.created':
          if (!evtTopicId) return state
          return transition(state, evtTopicId, 'drafting')

        case 'topic.claimed':
        case 'topic.released':
        case 'topic.batch_updated':
          // Ownership/data edits do not change workflow stage.
          return state

        case 'annotation.drafted':
          // Drafts don't change stage; still drafting/revising.
          return state

        case 'annotation.submitted':
          if (!evtTopicId) return state
          return transition(state, evtTopicId, 'submitted')

        case 'annotation.approved':
          if (!evtTopicId) return state
          return transition(state, evtTopicId, 'approved')

        case 'annotation.rejected':
          if (!evtTopicId) return state
          return transition(state, evtTopicId, 'rejected')

        case 'annotation.revised':
          if (!evtTopicId) return state
          return transition(state, evtTopicId, 'revising')

        default:
          return state
      }
    },
  }
}
