'use server'

/**
 * Phase-9 Trust Coach action. The rater requests it from their
 * /my/quality page; we run the existing my-quality query for the
 * specific workspace, hand the data to Claude (via lib/ai/trust-coach),
 * log the call, return the structured note.
 *
 * Auth: requires signed-in user. We don't gate by trust-status —
 * suspended users especially need the explanation. Cooldown 60s/user
 * to keep token cost predictable.
 */

import { z } from 'zod'
import { and, eq, gt } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { aiCallLog } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth/guards'
import { uuidLike } from '@/lib/validators/uuid'
import { AppError, NotFoundError } from '@/lib/errors'
import { getMyQuality } from '@/lib/queries/my-quality'
import {
  assertWithinDailyAIQuota,
  logAICall,
} from '@/lib/ai/quota'
import {
  generateCoachFeedback,
  type CoachFeedback,
} from '@/lib/ai/trust-coach'

const inputSchema = z.object({ workspaceId: uuidLike })

const COOLDOWN_MS = 60 * 1000

export async function requestCoachFeedback(
  input: z.infer<typeof inputSchema>,
): Promise<{ ok: true; feedback: CoachFeedback }> {
  const parsed = inputSchema.parse(input)
  const me = await requireUser()
  const db = getDb()

  // Cooldown — 60s per user. The coach is high-cost Sonnet by
  // default; let's not let a rater mash the button.
  const since = new Date(Date.now() - COOLDOWN_MS)
  const [recent] = await db
    .select({ id: aiCallLog.id })
    .from(aiCallLog)
    .where(
      and(
        eq(aiCallLog.userId, me.id),
        eq(aiCallLog.feature, 'trust-coach'),
        gt(aiCallLog.ts, since),
      ),
    )
    .limit(1)
  if (recent) {
    throw new AppError(
      'COOLDOWN',
      'Please wait ~60 seconds before requesting another coaching note.',
      429,
    )
  }

  await assertWithinDailyAIQuota(me.id)

  // Pull this user's quality snapshot for the specified workspace
  // only — no cross-workspace leakage.
  const snapshot = await getMyQuality(me.id)
  const ws = snapshot.workspaces.find(
    (w) => w.workspaceId === parsed.workspaceId,
  )
  if (!ws) {
    throw new NotFoundError(
      'You have no submission history in this workspace yet.',
    )
  }

  const { feedback, usage } = await generateCoachFeedback({
    stats: {
      submitted: ws.submitted,
      approved: ws.approved,
      rejected: ws.rejected,
      pending: ws.pending,
    },
    weakAxes: ws.weakAxes,
    recentFeedback: ws.recentFeedback.map((f) => ({
      type: f.type,
      feedback: f.feedback,
    })),
    trustStatus: ws.trustStatus,
    statusReason: ws.trustStatusReason,
  })

  await logAICall({
    userId: me.id,
    feature: 'trust-coach',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: parsed.workspaceId,
  })

  return { ok: true, feedback }
}
