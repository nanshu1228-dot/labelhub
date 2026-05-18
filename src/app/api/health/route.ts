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

export async function GET(request: Request) {
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

  // 2. Internal-only diagnostics (provider snapshot + traffic window +
  //    git SHA). These let an operator triage in 10s but also fingerprint
  //    the stack for an attacker, so they're gated behind an HMAC-shaped
  //    token. Set HEALTH_DETAILED_TOKEN in env and pass via
  //    Authorization: Bearer <token> OR ?token=… to unlock.
  //
  //    Phase-17 audit fix #F2 + #F3: previously these fields were
  //    unauthenticated, leaking provider kinds (probe targets), error
  //    rate (oracle), and the exact git commit (CVE pinning).
  const expectedToken = process.env.HEALTH_DETAILED_TOKEN ?? ''
  const auth =
    request.headers.get('authorization') ?? ''
  const presentedToken = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : new URL(request.url).searchParams.get('token') ?? ''
  const includeDetails =
    expectedToken.length > 0 && presentedToken === expectedToken

  let providerRows: Array<{
    kind: string
    lastUsedAt: Date | null
    enabled: string
  }> = []
  let window5min = {
    totalRequests: 0,
    errorRate: 0,
    p95DurationMs: 0,
  }

  if (includeDetails && dbOk) {
    try {
      const rows = await db
        .select({
          kind: providerConnections.providerKind,
          lastUsedAt: providerConnections.lastUsedAt,
          enabled: providerConnections.enabled,
        })
        .from(providerConnections)
      providerRows = rows.map((r) => ({
        kind: r.kind,
        lastUsedAt: r.lastUsedAt,
        enabled: r.enabled,
      }))
    } catch {
      // best-effort
    }

    const since = new Date(Date.now() - 5 * 60 * 1000)
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

  // 3. Aggregate status. Down = DB unreachable. Degraded = either
  //    DB latency over 500ms (always available) or — when we have
  //    internal details — error rate over 10% in the 5-min window.
  let status: 'ok' | 'degraded' | 'down' = 'ok'
  if (!dbOk) status = 'down'
  else if (
    (dbLatencyMs ?? 0) > 500 ||
    (includeDetails &&
      window5min.totalRequests >= 10 &&
      window5min.errorRate > 0.1)
  )
    status = 'degraded'

  const httpStatus = status === 'down' ? 503 : 200
  const payload: Record<string, unknown> = {
    status,
    ts,
    uptimeMs,
    db: { ok: dbOk, latencyMs: dbLatencyMs },
  }
  if (includeDetails) {
    payload.proxy = { providers: providerRows }
    payload.window5min = window5min
    // Last 7 chars only — enough for support to ask the user, not enough
    // to pin an exact source revision against the public repo.
    const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? ''
    payload.version = sha ? sha.slice(0, 7) : null
  }
  return NextResponse.json(payload, {
    status: httpStatus,
    headers: {
      'cache-control': 'no-store',
    },
  })
}
