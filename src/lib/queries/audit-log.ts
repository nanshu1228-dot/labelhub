import 'server-only'
import { and, count, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events, users, workspaceMembers } from '@/lib/db/schema'

/**
 * Workspace audit-log search — admin's "what happened around person X"
 * surface.
 *
 * The events table is already the source of truth for every state
 * change (verdicts, restores, trust transitions, etc.); this query is
 * just the search layer on top so admins don't have to read raw JSON.
 *
 * Search semantics:
 *   - subjectUserId  → exact match on the events that touch that user
 *                       (as actor OR submitter OR target of a status change)
 *   - userQuery      → free-text search on display_name + email of the
 *                       resolved user, returning events for anyone matching
 *   - types          → event type whitelist (e.g. only rejected/revised)
 *   - since          → cap how far back to scan
 *   - limit          → row count cap (default 100, max 500)
 *
 * Returns rows pre-joined with actor name + (when payload carries a
 * submitterUserId or userId) the affected rater's name, so the UI can
 * render "Bob (admin) rejected Alice's annotation" without follow-up
 * lookups.
 */

/** Event types that surface in the audit UI. We expose a curated set
 *  so admins aren't drowning in noise like 'workspace.member.added'. */
export const AUDIT_EVENT_GROUPS = {
  verdict: [
    'annotation.approved',
    'annotation.rejected',
    'annotation.revised',
    'annotation.qc_passed',
    'annotation.submitted',
    'annotation.awaiting_acceptance',
    'annotation.revising',
  ],
  restore: [
    'annotation.restored',
    'annotation.review_replied',
    'review.reply',
  ],
  trust: [
    'workspace.trust_status_changed',
    'workspace.seed_claimed',
    'trust.restored',
  ],
  inbox: ['notification.bulk_mark_read'],
  judge: [
    'llm_judge.run_completed',
    'llm_judge.run_failed',
    'llm_judge.created',
    'llm_judge.revoked',
  ],
  /** AI pre-review pipeline — append-only verdict events the LLM gate
   *  emits before a human ever sees the annotation. actorId is null (AI
   *  is the actor), so these are the highest-frequency *non-human* state
   *  changes; surfaced here so admins can audit "what did the AI gate do". */
  ai_review: [
    'ai_review.started',
    'ai_review.completed',
    'ai_review.sent_back',
    'ai_review.failed',
  ],
  /** Dawid-Skene EM truth-inference runs (Phase-11) — admin-triggered,
   *  visible in audit so an admin's coworker can see "Alice ran DS at 4pm". */
  consensus: ['ds.run_completed'],
  /** Invite-reward lifecycle (Phase-13) — money-path events that admins
   *  must be able to retroactively audit. */
  invite: [
    'invite_reward.granted',
    'invite_reward.manual_review',
    'invite_reward.blocked',
    'invite_reward.denied',
  ],
  /** Dataset-version freeze + export (Phase-14) + general /api/export. */
  dataset: [
    'dataset.version_frozen',
    'dataset.version_exported',
    'export.created',
  ],
  /** API-key lifecycle (Maintenance pass — security audit surface). */
  apikey: ['api_key.created', 'api_key.revoked'],
  /** Workspace structural changes + provider/tool plumbing. Admins
   *  reviewing "who changed our config" land here. */
  workspace: [
    'workspace.created',
    'workspace.renamed',
    'provider_connection.created',
    'provider_connection.disabled',
    'provider_connection.deleted',
    'tool_provider.declared',
    'tool_provider.updated',
    'tool_provider.deprecated',
  ],
  /** Task + topic + scope lifecycle — every publish / claim / scope
   *  edit lands here. */
  task: [
    'task.created',
    'task.updated',
    'task.published',
    'task.paused',
    'task.resumed',
    'task.closed',
    'task.archived',
    'topic.created',
    'topic.batch_updated',
    'topic.claimed',
    'topic.released',
    'topic_scope.auto_generated',
    'topic_scope.edited',
    'topic_scope.regenerated',
  ],
  /** Money path: payouts + wallet withdrawals. Separate from invite
   *  rewards (which have their own group) so admins can filter to
   *  just the "the platform paid someone" events. */
  payout: [
    'payout.paid',
    'payout_period.closed',
    'wallet.withdraw_requested',
  ],
  /** Gold standards + guideline-refiner patch lifecycle. */
  gold: [
    'gold.removed',
    'guideline_patch.proposed',
    'guideline_patch.accepted',
    'guideline_patch.rejected',
  ],
} as const

export type AuditGroup = keyof typeof AUDIT_EVENT_GROUPS

/** Map a single event type to its group label for chip rendering. */
export function groupForEventType(type: string): AuditGroup | 'other' {
  for (const [g, list] of Object.entries(AUDIT_EVENT_GROUPS) as Array<
    [AuditGroup, readonly string[]]
  >) {
    if (list.includes(type)) return g
  }
  return 'other'
}

export interface AuditRow {
  id: string
  ts: Date
  type: string
  group: AuditGroup | 'other'
  /** Who DID it (admin / rater / system). */
  actorId: string | null
  actorDisplayName: string | null
  actorEmail: string | null
  /** Who it was DONE TO when the payload identifies a subject (the
   *  rater whose annotation was rejected / status changed / etc.). */
  subjectUserId: string | null
  subjectDisplayName: string | null
  subjectEmail: string | null
  /** Free-form payload — UI picks specific fields to surface (decision,
   *  feedback, status, reason). */
  payload: Record<string, unknown>
}

export interface AuditSearchOpts {
  workspaceId: string
  /** Exact subject filter — overrides userQuery if both are given. */
  subjectUserId?: string
  /** Free-text match against display_name + email. Empty string = no
   *  filter. Wildcards added automatically. */
  userQuery?: string
  /** Event type whitelist; omit for "all events from AUDIT_EVENT_GROUPS". */
  types?: readonly string[]
  /** Lower bound on events.ts. Defaults to 90 days back. */
  since?: Date
  /** Cap on returned rows. Default 100, max 500. */
  limit?: number
  /** Row offset for DB-level pagination. Default 0. */
  offset?: number
}

export async function searchAuditLog(
  opts: AuditSearchOpts,
): Promise<AuditRow[]> {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 100, 500)
  const offset = Math.max(opts.offset ?? 0, 0)
  const since =
    opts.since ?? new Date(Date.now() - 90 * 24 * 3600 * 1000)

  // Resolve user filter when free-text was supplied. We do a single
  // upfront lookup on the workspace's members so we end up with a
  // bounded id list before hitting the events table — much cheaper
  // than joining on every event row.
  const resolvedUserIds: string[] = []
  if (opts.subjectUserId) {
    resolvedUserIds.push(opts.subjectUserId)
  } else if (opts.userQuery && opts.userQuery.trim().length > 0) {
    const q = `%${opts.userQuery.trim()}%`
    const memberMatches = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, opts.workspaceId),
          or(
            ilike(users.email, q),
            ilike(users.displayName, q),
          ),
        ),
      )
      .limit(50)
    for (const r of memberMatches) {
      if (!resolvedUserIds.includes(r.userId)) {
        resolvedUserIds.push(r.userId)
      }
    }
    // No match at all → return empty (don't fall through to
    // "everyone" — the admin's search would surprise them otherwise).
    if (resolvedUserIds.length === 0) return []
  }

  // Build the WHERE: workspace + types + (optional) user predicate.
  const defaultTypes = Object.values(AUDIT_EVENT_GROUPS).flat() as string[]
  const types =
    opts.types && opts.types.length > 0 ? opts.types : defaultTypes

  // Per-user filter — match any of: actorId, payload.submitterUserId,
  // payload.userId. Keep the SQL compact by using `IN` for the id
  // list once (when present).
  const userFilter =
    resolvedUserIds.length > 0
      ? or(
          inArray(events.actorId, resolvedUserIds),
          sql`${events.payload} ->> 'submitterUserId' = ANY(${resolvedUserIds})`,
          sql`${events.payload} ->> 'userId' = ANY(${resolvedUserIds})`,
        )
      : undefined

  const rows = await db
    .select({
      id: events.id,
      ts: events.ts,
      type: events.type,
      actorId: events.actorId,
      actorDisplayName: users.displayName,
      actorEmail: users.email,
      payload: events.payload,
    })
    .from(events)
    .leftJoin(users, eq(users.id, events.actorId))
    .where(
      and(
        eq(events.workspaceId, opts.workspaceId),
        inArray(events.type, types),
        gte(events.ts, since),
        ...(userFilter ? [userFilter] : []),
      ),
    )
    .orderBy(desc(events.ts))
    .limit(limit)
    .offset(offset)

  // Second pass: resolve the SUBJECT name (the rater an action was
  // taken AGAINST). Different event types stash this in different
  // payload keys, so we extract here.
  const subjectIds = new Set<string>()
  for (const r of rows) {
    const p = (r.payload ?? {}) as Record<string, unknown>
    const sid =
      typeof p.submitterUserId === 'string'
        ? p.submitterUserId
        : typeof p.userId === 'string'
          ? p.userId
          : null
    if (sid) subjectIds.add(sid)
  }
  const subjectsById = new Map<
    string,
    { displayName: string | null; email: string | null }
  >()
  if (subjectIds.size > 0) {
    const subjectRows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .where(inArray(users.id, Array.from(subjectIds)))
    for (const s of subjectRows) {
      subjectsById.set(s.id, {
        displayName: s.displayName,
        email: s.email,
      })
    }
  }

  return rows.map((r) => {
    const payload = (r.payload ?? {}) as Record<string, unknown>
    const subjectUserId =
      typeof payload.submitterUserId === 'string'
        ? payload.submitterUserId
        : typeof payload.userId === 'string'
          ? payload.userId
          : null
    const subject = subjectUserId ? subjectsById.get(subjectUserId) : null
    return {
      id: r.id,
      ts: r.ts,
      type: r.type,
      group: groupForEventType(r.type),
      actorId: r.actorId,
      actorDisplayName: r.actorDisplayName,
      actorEmail: r.actorEmail,
      subjectUserId,
      subjectDisplayName: subject?.displayName ?? null,
      subjectEmail: subject?.email ?? null,
      payload,
    }
  })
}

/**
 * Resolve the same user-id filter `searchAuditLog` uses (free-text → member
 * ids, or an exact subject id). Returns `null` when a free-text query matched
 * no members — the caller should treat that as an empty result, exactly like
 * `searchAuditLog`'s early `return []`.
 */
async function resolveAuditUserIds(
  opts: Pick<AuditSearchOpts, 'workspaceId' | 'subjectUserId' | 'userQuery'>,
): Promise<string[] | null> {
  const db = getDb()
  const resolvedUserIds: string[] = []
  if (opts.subjectUserId) {
    resolvedUserIds.push(opts.subjectUserId)
  } else if (opts.userQuery && opts.userQuery.trim().length > 0) {
    const q = `%${opts.userQuery.trim()}%`
    const memberMatches = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, opts.workspaceId),
          or(ilike(users.email, q), ilike(users.displayName, q)),
        ),
      )
      .limit(50)
    for (const r of memberMatches) {
      if (!resolvedUserIds.includes(r.userId)) {
        resolvedUserIds.push(r.userId)
      }
    }
    if (resolvedUserIds.length === 0) return null
  }
  return resolvedUserIds
}

/**
 * Paginated audit-log search. Same filters + ordering as `searchAuditLog`,
 * but returns `{ rows, total }` where `total` is the full count of matching
 * events (before limit/offset) so the page can render a Prev/Next control.
 *
 * Paging is pushed into SQL (LIMIT/OFFSET via `searchAuditLog`'s own offset
 * support), so older matches past the first page are no longer dropped.
 */
export async function searchAuditLogPaged(
  opts: AuditSearchOpts,
): Promise<{ rows: AuditRow[]; total: number }> {
  const db = getDb()
  const since = opts.since ?? new Date(Date.now() - 90 * 24 * 3600 * 1000)

  // Resolve the same user filter the row query uses so `total` matches the
  // rows exactly. A free-text query with no member matches → empty result.
  const resolvedUserIds = await resolveAuditUserIds(opts)
  if (resolvedUserIds === null) return { rows: [], total: 0 }

  const defaultTypes = Object.values(AUDIT_EVENT_GROUPS).flat() as string[]
  const types =
    opts.types && opts.types.length > 0 ? opts.types : defaultTypes

  const userFilter =
    resolvedUserIds.length > 0
      ? or(
          inArray(events.actorId, resolvedUserIds),
          sql`${events.payload} ->> 'submitterUserId' = ANY(${resolvedUserIds})`,
          sql`${events.payload} ->> 'userId' = ANY(${resolvedUserIds})`,
        )
      : undefined

  const whereExpr = and(
    eq(events.workspaceId, opts.workspaceId),
    inArray(events.type, types),
    gte(events.ts, since),
    ...(userFilter ? [userFilter] : []),
  )

  const [totalRow] = await db
    .select({ n: count() })
    .from(events)
    .where(whereExpr)
  const total = totalRow?.n ?? 0

  const rows = await searchAuditLog(opts)
  return { rows, total }
}
