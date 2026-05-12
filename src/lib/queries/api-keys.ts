import 'server-only'
import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { apiRequestLog, workspaceApiKeys } from '@/lib/db/schema'

/**
 * API key usage analytics.
 *
 * Reads from `api_request_log` to give publishers visibility into:
 *   - How often each key is hit
 *   - Success vs error rates
 *   - 7-day timeline (for charting)
 *
 * Auth is the CALLER'S responsibility (these are pure data accessors).
 */

export interface ApiKeyUsageSummary {
  apiKeyId: string
  totalCalls: number
  successCalls: number
  errorCalls: number
  last24hCalls: number
  last7dCalls: number
  timeline: Array<{ day: string; calls: number; errors: number }> // last 7 days
}

export async function getApiKeyUsage(
  apiKeyId: string,
): Promise<ApiKeyUsageSummary> {
  const db = getDb()
  const now = new Date()
  const since24h = new Date(now.getTime() - 24 * 3600 * 1000)
  const since7d = new Date(now.getTime() - 7 * 86_400 * 1000)

  // Aggregate counts in one round-trip via three sub-queries.
  const [total] = await db
    .select({
      total: count(),
      errors: sql<number>`SUM(CASE WHEN ${apiRequestLog.status} >= 400 THEN 1 ELSE 0 END)::int`,
    })
    .from(apiRequestLog)
    .where(eq(apiRequestLog.apiKeyId, apiKeyId))

  const [recent24h] = await db
    .select({ n: count() })
    .from(apiRequestLog)
    .where(
      and(
        eq(apiRequestLog.apiKeyId, apiKeyId),
        gte(apiRequestLog.ts, since24h),
      ),
    )

  const [recent7d] = await db
    .select({ n: count() })
    .from(apiRequestLog)
    .where(
      and(eq(apiRequestLog.apiKeyId, apiKeyId), gte(apiRequestLog.ts, since7d)),
    )

  // Daily timeline (last 7 days)
  const dailyRows = await db
    .select({
      day: sql<string>`to_char(${apiRequestLog.ts}, 'YYYY-MM-DD')`,
      calls: count(),
      errors: sql<number>`SUM(CASE WHEN ${apiRequestLog.status} >= 400 THEN 1 ELSE 0 END)::int`,
    })
    .from(apiRequestLog)
    .where(
      and(eq(apiRequestLog.apiKeyId, apiKeyId), gte(apiRequestLog.ts, since7d)),
    )
    .groupBy(sql`to_char(${apiRequestLog.ts}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${apiRequestLog.ts}, 'YYYY-MM-DD') ASC`)

  const totalCalls = total?.total ?? 0
  const errors = total?.errors ?? 0

  return {
    apiKeyId,
    totalCalls,
    successCalls: totalCalls - errors,
    errorCalls: errors,
    last24hCalls: recent24h?.n ?? 0,
    last7dCalls: recent7d?.n ?? 0,
    timeline: dailyRows.map((r) => ({
      day: r.day,
      calls: r.calls,
      errors: r.errors,
    })),
  }
}

/**
 * Workspace-wide API usage: aggregates across all keys + user-session calls.
 * Shows endpoint breakdown for dashboard.
 */
export async function getWorkspaceApiUsage(workspaceId: string) {
  const db = getDb()
  const since7d = new Date(Date.now() - 7 * 86_400 * 1000)

  const [total] = await db
    .select({
      total: count(),
      errors: sql<number>`SUM(CASE WHEN ${apiRequestLog.status} >= 400 THEN 1 ELSE 0 END)::int`,
      p50Duration: sql<number>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${apiRequestLog.durationMs})::int`,
      p95Duration: sql<number>`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${apiRequestLog.durationMs})::int`,
    })
    .from(apiRequestLog)
    .where(
      and(
        eq(apiRequestLog.workspaceId, workspaceId),
        gte(apiRequestLog.ts, since7d),
      ),
    )

  const byEndpoint = await db
    .select({
      endpoint: apiRequestLog.endpoint,
      calls: count(),
    })
    .from(apiRequestLog)
    .where(
      and(
        eq(apiRequestLog.workspaceId, workspaceId),
        gte(apiRequestLog.ts, since7d),
      ),
    )
    .groupBy(apiRequestLog.endpoint)
    .orderBy(desc(count()))

  return {
    last7dCalls: total?.total ?? 0,
    last7dErrors: total?.errors ?? 0,
    p50DurationMs: total?.p50Duration ?? null,
    p95DurationMs: total?.p95Duration ?? null,
    byEndpoint,
  }
}

/**
 * Top-level workspace summary: all keys + their last-used + active status.
 */
export async function listApiKeysWithStatus(workspaceId: string) {
  const db = getDb()
  return db
    .select({
      id: workspaceApiKeys.id,
      name: workspaceApiKeys.name,
      prefix: workspaceApiKeys.prefix,
      createdAt: workspaceApiKeys.createdAt,
      lastUsedAt: workspaceApiKeys.lastUsedAt,
      expiresAt: workspaceApiKeys.expiresAt,
      revokedAt: workspaceApiKeys.revokedAt,
      isActive: sql<boolean>`${workspaceApiKeys.revokedAt} IS NULL AND (${workspaceApiKeys.expiresAt} IS NULL OR ${workspaceApiKeys.expiresAt} > now())`,
    })
    .from(workspaceApiKeys)
    .where(eq(workspaceApiKeys.workspaceId, workspaceId))
    .orderBy(desc(workspaceApiKeys.createdAt))
}
