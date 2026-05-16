import 'server-only'
import { getDb } from '@/lib/db/client'
import { notifications } from '@/lib/db/schema'

/**
 * Notification emit helper — called from server actions when something
 * happens that the affected user should hear about (annotation review
 * verdict, reviewer reply, etc).
 *
 * Design:
 *   - Pure write — never throws on the caller's hot path; if the DB
 *     burps we log and continue. Notifications are a "nice to have"
 *     side effect, NEVER a blocker for the primary action (verdict
 *     etc.).
 *   - No "don't notify yourself" check here — the caller decides who
 *     the recipient is. The reviewer should not notify themselves, the
 *     submitter SHOULD be notified when their reviewer replies. Both
 *     are caller responsibilities.
 *   - Type is a free-form string. We curate the canonical set here in
 *     `NotificationType` but allow callers to extend without a
 *     migration.
 */

export type NotificationType =
  | 'annotation.approved'
  | 'annotation.rejected'
  | 'annotation.revising'
  | 'annotation.awaiting_acceptance'
  | 'review.reply'

export interface EmitNotificationInput {
  /** Recipient — the user whose inbox this lands in. */
  userId: string
  /** Workspace scope. */
  workspaceId: string
  /** Canonical type (or a future extension). */
  type: NotificationType | string
  /** Short title shown in inbox row. */
  title: string
  /** Optional preview line (1-line, truncated by the UI). */
  body?: string
  /** Where clicking the notification jumps to. */
  linkUrl: string
  /** Free-form structured data for the UI to render richer states. */
  payload?: Record<string, unknown>
  /** Who triggered this (reviewer / admin / system). Null = system. */
  actorId?: string | null
}

/**
 * Insert a notification row. Never throws — failures are logged so
 * the primary write (verdict / reply / etc.) isn't blocked by an
 * inbox hiccup.
 */
export async function emitNotification(
  input: EmitNotificationInput,
): Promise<void> {
  try {
    const db = getDb()
    await db.insert(notifications).values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      type: input.type,
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
      payload: input.payload ?? {},
      actorId: input.actorId ?? null,
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[notifications] failed to emit ${input.type} → ${input.userId}:`,
      e instanceof Error ? e.message : e,
    )
  }
}

/**
 * Convenience batch — used when one event fans out to multiple
 * recipients (e.g. notify every annotator on a topic when admin
 * publishes new guidelines). Each row is independent; one failure
 * doesn't block the rest.
 */
export async function emitNotifications(
  inputs: readonly EmitNotificationInput[],
): Promise<void> {
  if (inputs.length === 0) return
  await Promise.allSettled(inputs.map((i) => emitNotification(i)))
}
