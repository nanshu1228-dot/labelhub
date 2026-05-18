import { NextResponse } from 'next/server'
import { gte, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { apiRequestLog, providerConnections } from '@/lib/db/schema'

/**
 * GET /api/health → public, no auth, JSON.
 *
 * Phase-17 (17d) operational signal endpoint. Returns:
 *
 *   {
 *     status: 'ok' | 'degraded' | 'down',
 *     ts: "<ISO>",
 *     uptimeMs: 12345,
 *     db: { latencyMs, ok },
 *     proxy: { providers: [{ kind, identifier, lastUsedAt, status }] },
 *     window5min: { totalRequests, errorRate, p95DurationMs },
 *   }
 *
 * Used by:
 *   - Status page / uptime monitors (StatusCake, BetterStack)
 *   - Demo-day judges who want to verify the platform is alive
 *   - Future /admin dashboard health card
 *
 * Performance: caps at ~50ms when DB is healthy. The most expensive
 * piece is the api_request_log scan; bounded by the 5-min window +
 * the (ts) btree.
 */

const STARTED_AT = Date.now()

export async function GET() {
  const ts = new Date().toISOString()
  const uptimeMs = Date.now() - STARTED_AT
  const db = getDb()

  // 1. DB liveness ping.
  let dbLatencyMs: number | null = null
  let dbOk = false
  const dbT0 = Date.now()
  try {
    await db.execute(sql`SELECT 1`)
    dbOk = true
    dbLatencyMs = Date.now() - dbT0
  } catch {
    dbLatencyMs = Date.now() - dbT0
  }

  // 2. Proxy provider snapshot — list connections + their last-used
  //    timestamp so an operator sees which upstreams have been hot.
  let providerRows: Array<{
    kind: string
    displayName: string
    lastUsedAt: Date | null
    enabled: string
  }> = []
  if (dbOk) {
    try {
      const rows = await db
        .select({
          kind: providerConnections.providerKind,
          displayName: providerConnections.displayName,
          lastUsedAt: providerConnections.lastUsedAt,
          enabled: providerConnections.enabled,
        })
        .from(providerConnections)
      providerRows = rows.map((r) => ({
        kind: r.kind,
        displayName: r.displayName,
        lastUsedAt: r.lastUsedAt,
        enabled: r.enabled,
      }))
    } catch {
      // already report dbOk=false in that case; providers section is best-effort
    }
  }

  // 3. Last-5-minute traffic window — total requests + error rate +
  //    p95 latency. Uses percentile_disc which most Postgres versions
  //    support without extensions.
  const since = new Date(Date.now() - 5 * 60 * 1000)
  let window5min = {
    totalRequests: 0,
    errorRate: 0,
    p95DurationMs: 0,
  }
  if (dbOk) {
    try {
      const [row] = await db
        .select({
          total: sql<number>`count(*)::int`,
          errors: sql<number>`sum(case when ${apiRequestLog.status} >= 400 then 1 else 0 end)::int`,
          p95: sql<number>`coalesce(percentile_disc(0.95) within group (order by ${apiRequestLog.durationMs}), 0)::int`,
        })
        .from(apiRequestLog)
        .where(gte(apiRequestLog.ts, since))
      const total = Number(row?.total ?? 0)
      const errors = Number(row?.errors ?? 0)
      const p95 = Number(row?.p95 ?? 0)
      window5min = {
        totalRequests: total,
        errorRate: total > 0 ? errors / total : 0,
        p95DurationMs: p95,
      }
    } catch {
      // best-effort
    }
  }

  // 4. Aggregate status. Down = DB unreachable. Degraded = error
  //    rate over the 5-min window crossed 10% with non-trivial volume,
  //    or db latency > 500ms.
  let status: 'ok' | 'degraded' | 'down' = 'ok'
  if (!dbOk) status = 'down'
  else if (
    (dbLatencyMs ?? 0) > 500 ||
    (window5min.totalRequests >= 10 && window5min.errorRate > 0.1)
  )
    status = 'degraded'

  const httpStatus = status === 'down' ? 503 : 200
  return NextResponse.json(
    {
      status,
      ts,
      uptimeMs,
      db: { ok: dbOk, latencyMs: dbLatencyMs },
      proxy: { providers: providerRows },
      window5min,
      version: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },
    {
      status: httpStatus,
      headers: {
        // Health is checked by monitors at high frequency — don't cache.
        'cache-control': 'no-store',
      },
    },
  )
}
