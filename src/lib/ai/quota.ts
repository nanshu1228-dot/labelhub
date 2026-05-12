import 'server-only'
import { and, count, eq, gt } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { aiCallLog } from '@/lib/db/schema'
import { QuotaExceededError } from '@/lib/errors'

/**
 * AI call quota — per-user daily cap.
 *
 * Per security model: prevent runaway token spend by buggy or malicious clients.
 * Check BEFORE every Claude call; log AFTER (success or failure both count
 * against the quota, since the API was actually invoked).
 *
 * Tune via env var `AI_DAILY_LIMIT_PER_USER` in production; defaults to 100.
 */

export const DAILY_AI_LIMIT_PER_USER = Number(
  process.env.AI_DAILY_LIMIT_PER_USER ?? '100',
)

/** Throws QuotaExceededError if the user has hit their daily cap. */
export async function assertWithinDailyAIQuota(userId: string): Promise<void> {
  const since = new Date(Date.now() - 24 * 3600 * 1000)
  const db = getDb()
  const [row] = await db
    .select({ n: count() })
    .from(aiCallLog)
    .where(and(eq(aiCallLog.userId, userId), gt(aiCallLog.ts, since)))
  const used = row?.n ?? 0
  if (used >= DAILY_AI_LIMIT_PER_USER) {
    throw new QuotaExceededError(
      `Daily AI quota reached (${used}/${DAILY_AI_LIMIT_PER_USER}). Resets in 24h.`,
    )
  }
}

export async function logAICall(args: {
  userId: string
  feature: string
  model: string
  inputTokens: number
  outputTokens: number
  workspaceId?: string | null
}): Promise<void> {
  const db = getDb()
  await db.insert(aiCallLog).values({
    userId: args.userId,
    feature: args.feature,
    model: args.model,
    tokensIn: args.inputTokens,
    tokensOut: args.outputTokens,
    workspaceId: args.workspaceId ?? null,
  })
}
