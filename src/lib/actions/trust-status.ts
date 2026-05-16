'use server'

/**
 * Phase-9 trust lifecycle actions — admin-only.
 *
 *   setTrustStatus({workspaceId, userId, status, reason})
 *     → flip a member's trust lifecycle:
 *         'active'    — default, full earn / claim
 *         'probation' — can claim + submit, but admin reviews every
 *                        verdict more carefully; bonus pay halved
 *                        (handled in calculate-payout if we add it)
 *         'suspended' — no new claims; existing drafts can submit;
 *                        payouts halt until lifted
 *     Emits a `workspace.trust_status_changed` event + sends a
 *     notification to the affected rater explaining the change.
 *
 * Reversible by re-running with status='active'.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events, workspaceMembers, workspaces } from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { uuidLike } from '@/lib/validators/uuid'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { emitNotification } from '@/lib/notifications/emit'

export type TrustStatus = 'active' | 'probation' | 'suspended'

/**
 * Read the trust status of a user in a workspace. Defaults to 'active'
 * when the row is missing (e.g. legacy member predating Phase-9 — the
 * NOT NULL default in DDL means new rows always have a value).
 *
 * Used by:
 *   - annotations.saveDraftAnnotation / .submitAnnotation to refuse
 *     new claims by suspended raters
 *   - billing.approveAnnotation to refuse payout creation for
 *     suspended raters (the work still archives, the money doesn't)
 */
export async function readTrustStatus(opts: {
  userId: string
  workspaceId: string
}): Promise<TrustStatus> {
  const db = getDb()
  const [row] = await db
    .select({ status: workspaceMembers.trustStatus })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, opts.userId),
        eq(workspaceMembers.workspaceId, opts.workspaceId),
      ),
    )
    .limit(1)
  const s = row?.status
  if (s === 'probation' || s === 'suspended' || s === 'active') return s
  return 'active'
}

const setStatusSchema = z.object({
  workspaceId: uuidLike,
  userId: uuidLike,
  status: z.enum(['active', 'probation', 'suspended']),
  /** Required for non-active transitions — surfaced verbatim to the
   *  rater so they know WHY they were flagged. */
  reason: z.string().max(2000).optional(),
})

export async function setTrustStatus(
  input: z.infer<typeof setStatusSchema>,
): Promise<{ ok: true }> {
  const parsed = setStatusSchema.parse(input)
  const { user: actor } = await requireWorkspaceAdmin(parsed.workspaceId)
  const db = getDb()

  // Refuse to suspend the workspace's primary admin — that's a foot-
  // gun where an admin could lock themselves out. Demoting yourself
  // is fine; the role check still gates writes elsewhere.
  const [ws] = await db
    .select({ adminId: workspaces.adminId, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, parsed.workspaceId))
    .limit(1)
  if (!ws) throw new NotFoundError('Workspace')
  if (
    parsed.status === 'suspended' &&
    ws.adminId === parsed.userId
  ) {
    throw new ValidationError(
      "Can't suspend the workspace's primary admin. Transfer ownership first.",
    )
  }

  // Non-active states require a reason — the rater deserves to know.
  if (parsed.status !== 'active' && !parsed.reason?.trim()) {
    throw new ValidationError(
      'Set a reason when moving someone to probation or suspended.',
    )
  }

  // Update the member row. If they aren't a member yet we error out —
  // the admin would have to invite them first.
  const [updated] = await db
    .update(workspaceMembers)
    .set({
      trustStatus: parsed.status,
      trustStatusReason:
        parsed.status === 'active' ? null : parsed.reason?.trim() ?? null,
      trustStatusAt: new Date(),
      trustStatusBy: actor.id,
    })
    .where(
      and(
        eq(workspaceMembers.workspaceId, parsed.workspaceId),
        eq(workspaceMembers.userId, parsed.userId),
      ),
    )
    .returning({ id: workspaceMembers.id })
  if (!updated) {
    throw new NotFoundError('Workspace member')
  }

  await db.insert(events).values({
    type: 'workspace.trust_status_changed',
    workspaceId: parsed.workspaceId,
    actorId: actor.id,
    payload: {
      userId: parsed.userId,
      status: parsed.status,
      reason: parsed.reason?.trim() ?? null,
    },
  })

  // Notify the affected rater. Probation / suspended states are
  // high-impact for them — they should hear about it the moment it
  // lands, not at the next payout. We let emitNotification swallow
  // its own errors so an inbox blip can't undo the status change.
  if (parsed.status !== 'active' && parsed.userId !== actor.id) {
    const title =
      parsed.status === 'probation'
        ? `Your work in ${ws.name} is under closer review`
        : `Your access in ${ws.name} has been paused`
    const body =
      parsed.reason?.trim() ??
      'See your /my/quality page for context and steps to restore access.'
    await emitNotification({
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      type:
        parsed.status === 'probation'
          ? 'trust.probation_started'
          : 'trust.suspended',
      title,
      body: body.slice(0, 140),
      linkUrl: `/my/quality`,
      payload: {
        status: parsed.status,
        reason: parsed.reason?.trim() ?? null,
      },
      actorId: actor.id,
    })
  } else if (parsed.status === 'active' && parsed.userId !== actor.id) {
    await emitNotification({
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      type: 'trust.restored',
      title: `Your access in ${ws.name} has been restored`,
      body: 'You can claim and submit topics again.',
      linkUrl: `/my/tasks`,
      payload: { status: 'active' },
      actorId: actor.id,
    })
  }

  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}/quality`)
    revalidatePath(
      `/workspaces/${parsed.workspaceId}/quality/raters/${parsed.userId}`,
    )
    revalidatePath('/my/quality')
    revalidatePath('/my/tasks')
  } catch {
    /* */
  }
  return { ok: true }
}
