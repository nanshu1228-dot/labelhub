import 'server-only'
import { asc, eq, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events } from '@/lib/db/schema'
import { fold } from '@/lib/events/projector'
import {
  createTrustProjection,
  type TrustProjectionState,
} from '@/lib/events/projections/trust-projection'
import type { EventBase } from '@/lib/events/types'

/**
 * Trust queries — derive user trust scores from the event log.
 *
 * Pulls events where the user is either the actor (submission) OR the
 * `payload.submitterUserId` (a review event). The projection picks the
 * relevant subset and applies Bayesian smoothing.
 */

export async function getTrustForUser(
  userId: string,
): Promise<TrustProjectionState> {
  const db = getDb()
  const rawEvents = await db
    .select()
    .from(events)
    .where(
      or(
        eq(events.actorId, userId),
        sql`payload->>'submitterUserId' = ${userId}`,
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

  return fold(projectionEvents, createTrustProjection(userId))
}
