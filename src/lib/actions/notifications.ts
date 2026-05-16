'use server'

/**
 * Notification server actions — the user-facing mutations on their
 * own inbox.
 *
 *   markNotificationRead({ id })
 *      → flip readAt for one notification (idempotent — already-read
 *        rows are no-ops)
 *   markAllRead()
 *      → flip readAt for every unread row owned by the calling user
 *
 * Both actions are scoped to the caller's user id at the SQL level —
 * `userId = me.id` is part of the UPDATE WHERE so a forged id can't
 * touch someone else's inbox.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { notifications } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth/guards'
import { uuidLike } from '@/lib/validators/uuid'

const MarkReadInput = z.object({ id: uuidLike })

export async function markNotificationRead(
  input: z.infer<typeof MarkReadInput>,
): Promise<{ ok: true }> {
  const parsed = MarkReadInput.parse(input)
  const me = await requireUser()
  const db = getDb()

  // Scoped UPDATE — the userId clause prevents one user from flipping
  // someone else's notification read state by guessing an id.
  await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.id, parsed.id),
        eq(notifications.userId, me.id),
        isNull(notifications.readAt),
      ),
    )

  try {
    revalidatePath('/my/inbox')
    revalidatePath('/my/queue')
  } catch {
    /* */
  }
  return { ok: true }
}

export async function markAllNotificationsRead(): Promise<{
  ok: true
  marked: number
}> {
  const me = await requireUser()
  const db = getDb()

  const rows = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(eq(notifications.userId, me.id), isNull(notifications.readAt)),
    )
    .returning({ id: notifications.id })

  try {
    revalidatePath('/my/inbox')
    revalidatePath('/my/queue')
  } catch {
    /* */
  }
  return { ok: true, marked: rows.length }
}
