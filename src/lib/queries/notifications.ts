import 'server-only'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { notifications, users, workspaces } from '@/lib/db/schema'

/**
 * Read-side of the notifications system.
 *
 *   countUnreadNotifications(userId)
 *      → cheap unread count for the header bell badge
 *   listMyNotifications({ userId, unreadOnly?, limit? })
 *      → paginated inbox feed with actor + workspace name joined
 *
 * The inbox list joins users + workspaces so the row renders
 * "from <Alice> in <Acme>" without N+1 follow-up lookups.
 */

export interface NotificationListItem {
  id: string
  type: string
  title: string
  body: string | null
  linkUrl: string
  payload: Record<string, unknown>
  workspaceId: string
  workspaceName: string
  actorId: string | null
  actorDisplayName: string | null
  actorEmail: string | null
  readAt: Date | null
  createdAt: Date
}

/**
 * Cheap unread counter. Used by the header bell — runs on every
 * page load through a layout, so it MUST stay fast. Index on
 * (userId, readAt) makes this a single-page scan.
 */
export async function countUnreadNotifications(
  userId: string,
): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(eq(notifications.userId, userId), isNull(notifications.readAt)),
    )
  return row?.n ?? 0
}

export interface ListMyNotificationsOpts {
  userId: string
  /** When true, return only unread rows. Default false (full feed). */
  unreadOnly?: boolean
  /** Hard cap at 100, soft default 30. */
  limit?: number
}

export async function listMyNotifications(
  opts: ListMyNotificationsOpts,
): Promise<NotificationListItem[]> {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 30, 100)

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      linkUrl: notifications.linkUrl,
      payload: notifications.payload,
      workspaceId: notifications.workspaceId,
      workspaceName: workspaces.name,
      actorId: notifications.actorId,
      actorDisplayName: users.displayName,
      actorEmail: users.email,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .innerJoin(workspaces, eq(workspaces.id, notifications.workspaceId))
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(
      opts.unreadOnly
        ? and(
            eq(notifications.userId, opts.userId),
            isNull(notifications.readAt),
          )
        : eq(notifications.userId, opts.userId),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit)

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    linkUrl: r.linkUrl,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    workspaceId: r.workspaceId,
    workspaceName: r.workspaceName,
    actorId: r.actorId,
    actorDisplayName: r.actorDisplayName,
    actorEmail: r.actorEmail,
    readAt: r.readAt,
    createdAt: r.createdAt,
  }))
}
