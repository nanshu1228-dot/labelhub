import 'server-only'
import { asc, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events, users } from '@/lib/db/schema'

/**
 * Full audit timeline for one annotation.
 *
 * Unlike `getReviewThread` (which only surfaces conversation-style verdict
 * events + replies), this query returns EVERY event that mentions the
 * annotation — including drafted, submitted, qc_passed, revised, approved,
 * rejected, review_replied. The point is to visualize the platform's
 * event-sourcing thesis: every state change is observable + auditable.
 *
 * Filters by `payload.annotationId === id` because the events table
 * doesn't have an annotation FK. Bounded by event-type whitelist so a
 * future custom event with `annotationId` in payload doesn't accidentally
 * surface (would need explicit allowlist update).
 *
 * Auth: caller's responsibility — we don't re-check workspace membership
 * here because the existing review-mode flow already gates the page.
 */

const TIMELINE_EVENT_TYPES = [
  'annotation.drafted',
  'annotation.submitted',
  'annotation.qc_passed',
  'annotation.revised',
  'annotation.approved',
  'annotation.rejected',
  'annotation.review_replied',
] as const

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number]

export interface TimelineEntry {
  eventId: string
  ts: Date
  type: TimelineEventType
  actorId: string | null
  actorDisplayName: string | null
  actorEmail: string | null
  /** Verdict / reply text where applicable. Empty string when none. */
  message: string
  /** Decision tag if the event carries one ('pass', 'request_revision', etc.). */
  decision: string | null
  /** Optional reviewer role denormalized on payload, when present. */
  reviewerRole: string | null
}

export async function getAnnotationAuditTimeline(opts: {
  annotationId: string
}): Promise<TimelineEntry[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: events.id,
      ts: events.ts,
      type: events.type,
      actorId: events.actorId,
      payload: events.payload,
    })
    .from(events)
    .where(inArray(events.type, [...TIMELINE_EVENT_TYPES]))
    .orderBy(asc(events.ts))

  // Filter by annotationId at the application layer — events.payload is
  // jsonb so an exact JSON match would require careful index work; for
  // MVP scale (thousands of events) the JS filter is fast.
  const filtered = rows.filter((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>
    return p.annotationId === opts.annotationId
  })
  if (filtered.length === 0) return []

  const actorIds = [
    ...new Set(filtered.map((r) => r.actorId).filter((id): id is string => !!id)),
  ]
  const userRows =
    actorIds.length > 0
      ? await db
          .select({
            id: users.id,
            displayName: users.displayName,
            email: users.email,
          })
          .from(users)
          .where(inArray(users.id, actorIds))
      : []
  const userById = new Map(userRows.map((u) => [u.id, u]))

  return filtered.map((r): TimelineEntry => {
    const p = (r.payload ?? {}) as Record<string, unknown>
    const u = r.actorId ? userById.get(r.actorId) : undefined
    const message =
      typeof p.message === 'string'
        ? p.message
        : typeof p.feedback === 'string'
          ? p.feedback
          : ''
    return {
      eventId: r.id,
      ts: r.ts,
      type: r.type as TimelineEventType,
      actorId: r.actorId,
      actorDisplayName: u?.displayName ?? null,
      actorEmail: u?.email ?? null,
      message,
      decision: typeof p.decision === 'string' ? p.decision : null,
      reviewerRole:
        typeof p.reviewerRole === 'string' ? p.reviewerRole : null,
    }
  })
}
