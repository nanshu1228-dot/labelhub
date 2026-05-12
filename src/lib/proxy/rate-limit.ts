import 'server-only'
import { and, count, eq, gte, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { providerRateLog } from '@/lib/db/schema'

/**
 * Per-connection RPM rate limiter — sliding-window via `provider_rate_log`.
 *
 * Why a separate table + counter query (vs. in-memory): the proxy runs as
 * a Vercel serverless function. Each invocation may live on a different
 * instance. In-memory state would let a workspace blow past its limit by
 * load-balancing across instances. Postgres is the only shared store, and
 * a single COUNT on a btree index is microseconds — cheap enough to do
 * on every proxy call.
 *
 * The window is 60 seconds wide. We:
 *   1. Insert a row marking THIS call FIRST (optimistic, in same tx)
 *   2. COUNT rows in the window
 *   3. If count > limit, fail the call (caller maps to 429)
 *
 * Insert-first means we ALWAYS log the attempt, even rejected ones — gives
 * accurate audit / rate-limit telemetry. The downside is that the rejected
 * call still consumed a DB row; acceptable given the alternative (race
 * conditions where two parallel inserts each see the pre-write count) is
 * worse.
 *
 * `tokensUsed` defaults to 0 on insert; the proxy updates it post-call
 * via `recordTokensForCall` once the upstream returns usage data. That
 * makes TPM (token-per-minute) limits enforceable on the NEXT call —
 * we can't pre-check tokens because we don't know how many the upstream
 * will use.
 */

export interface RateCheckResult {
  ok: boolean
  /** Current sliding-window count INCLUDING the just-inserted log row. */
  used: number
  /** When the OLDEST in-window log row falls off; informs Retry-After. */
  retryAfterSeconds: number
}

/**
 * Insert a log row, then check RPM. Returns the just-created log id so the
 * caller can later patch in tokens_used.
 */
export async function recordCallAndCheckRpm(opts: {
  connectionId: string
  limit: number
}): Promise<RateCheckResult & { logId: string }> {
  const db = getDb()
  const windowStart = new Date(Date.now() - 60_000)

  // Single tx: insert row then count.
  const [inserted] = await db
    .insert(providerRateLog)
    .values({ connectionId: opts.connectionId, tokensUsed: 0 })
    .returning({ id: providerRateLog.id, ts: providerRateLog.ts })

  const [row] = await db
    .select({ n: count() })
    .from(providerRateLog)
    .where(
      and(
        eq(providerRateLog.connectionId, opts.connectionId),
        gte(providerRateLog.ts, windowStart),
      ),
    )
  const used = row?.n ?? 0
  const ok = used <= opts.limit

  // Approximate retry-after = age of the oldest row + a 1s safety pad.
  let retryAfterSeconds = 0
  if (!ok) {
    const [oldest] = await db
      .select({ ts: providerRateLog.ts })
      .from(providerRateLog)
      .where(
        and(
          eq(providerRateLog.connectionId, opts.connectionId),
          gte(providerRateLog.ts, windowStart),
        ),
      )
      .orderBy(providerRateLog.ts)
      .limit(1)
    if (oldest) {
      const ageMs = Date.now() - oldest.ts.getTime()
      retryAfterSeconds = Math.max(1, Math.ceil((60_000 - ageMs) / 1000))
    } else {
      retryAfterSeconds = 60
    }
  }

  return { ok, used, retryAfterSeconds, logId: inserted.id }
}

/**
 * Post-call: patch the log row with the actual token usage. Used by the
 * proxy's after()-callback when upstream usage is known.
 */
export async function recordTokensForCall(
  logId: string,
  tokens: number,
): Promise<void> {
  const db = getDb()
  await db
    .update(providerRateLog)
    .set({ tokensUsed: tokens })
    .where(eq(providerRateLog.id, logId))
}

/**
 * Periodic cleanup — drop rate-log rows older than 24h. Wire to a cron
 * later; not invoked automatically.
 */
export async function pruneRateLog(olderThanHours = 24): Promise<number> {
  const db = getDb()
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000)
  const result = (await db.execute(
    sql`DELETE FROM provider_rate_log WHERE ts < ${cutoff}`,
  )) as unknown as { count?: number; rowCount?: number }
  return result.count ?? result.rowCount ?? 0
}
