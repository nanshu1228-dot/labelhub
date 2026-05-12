import 'server-only'
import { and, asc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events } from '@/lib/db/schema'
import { fold } from '@/lib/events/projector'
import {
  createTrajectoryEvalProjection,
  type TrajectoryEvalProjectionState,
} from '@/lib/events/projections/trajectory-eval-projection'
import type { EventBase } from '@/lib/events/types'

/**
 * "Watch Your Model Learn" — server-side data for the hero chart.
 *
 * Returns the accuracy curve + cumulative counters for an agent-trace-eval task.
 * The shape is UI-ready; Claude Design's chart components just plot
 * `result.timeline.map(p => ({ x: p.ts, y: p.smoothedScore }))`.
 */
export async function getAgentTaskAccuracy(
  taskId: string,
): Promise<TrajectoryEvalProjectionState> {
  const db = getDb()
  const rawEvents = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.type, 'annotation.approved'),
        sql`payload->>'taskId' = ${taskId}`,
      ),
    )
    .orderBy(asc(events.ts))

  const projectionEvents: EventBase[] = rawEvents.map((e) => ({
    id: e.id,
    type: e.type,
    ts: e.ts,
    actorId: e.actorId,
    workspaceId: e.workspaceId,
    payload: e.payload,
  }))

  return fold(projectionEvents, createTrajectoryEvalProjection(taskId))
}
