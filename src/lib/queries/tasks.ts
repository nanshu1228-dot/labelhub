import 'server-only'
import { and, asc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events, tasks } from '@/lib/db/schema'
import { fold } from '@/lib/events/projector'
import {
  createTaskProjection,
  type TaskProjectionState,
} from '@/lib/events/projections/task-projection'
import type { EventBase } from '@/lib/events/types'

/**
 * Task queries — including derived state via TaskProjection.
 *
 * `getTaskState` is the canonical example of how Pillar 2 (event sourcing)
 * powers reads: pre-filter events for the task, fold through the pure
 * projection, get current state + topic counts + lifecycle timestamps.
 */

export async function getTaskById(id: string) {
  const db = getDb()
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1)
  return task ?? null
}

export async function listTasksInWorkspace(workspaceId: string) {
  const db = getDb()
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.workspaceId, workspaceId))
    .orderBy(asc(tasks.createdAt))
}

/**
 * Derive the task's current state by folding its event history.
 *
 * SQL `payload->>'taskId' = $1` filter is the JSONB equivalent of
 * indexed lookup. For very large event tables, add a GIN index on
 * `(workspace_id, (payload->>'taskId'))`. For MVP, this is fast enough.
 */
export async function getTaskState(
  taskId: string,
): Promise<TaskProjectionState | null> {
  const task = await getTaskById(taskId)
  if (!task) return null

  const db = getDb()
  const rawEvents = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.workspaceId, task.workspaceId),
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

  return fold(projectionEvents, createTaskProjection(taskId))
}
