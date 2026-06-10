import { z } from 'zod'

/**
 * Event Sourcing — Pillar 2.
 *
 * State is derived from append-only events; events are immutable.
 * Replay = traversing the log; time-travel debugging falls out for free.
 */

export const eventBaseSchema = z.object({
  id: z.string(),
  type: z.string(),
  ts: z.date(),
  /** User who triggered the event; null for system events */
  actorId: z.string().nullable(),
  workspaceId: z.string(),
  payload: z.unknown(),
})
export type EventBase = z.infer<typeof eventBaseSchema>

/** Known event types — extend as features land. */
export type LabelHubEventType =
  | 'workspace.created'
  | 'task.created'
  | 'task.updated'
  | 'task.published'
  | 'task.paused'
  | 'task.resumed'
  | 'task.closed'
  | 'task.archived'
  | 'topic.created'
  | 'topic.batch_updated'
  | 'annotation.drafted'
  | 'annotation.submitted'
  | 'annotation.revised'
  | 'annotation.qc_passed'
  | 'annotation.approved'
  | 'annotation.rejected'
  | 'annotation.review_replied'
  | 'guideline.proposed'
  | 'guideline.merged'
  | 'trust.recomputed'
  | 'ai.coannotation.proposed'
  | 'ai.coannotation.accepted'
  | 'ai.coannotation.edited'
