import 'server-only'

/**
 * In-memory sliding-window rate limiter for unauthenticated public
 * endpoints (Phase-maint #4+#7 from the 3rd security audit).
 *
 * Scope:
 *   /api/health        — DB ping, easy to spam
 *   /api/demo/info     — exposes the live demo key, attractive to spam
 *   /api/admin/diag    — already token-gated but probe attempts add log noise
 *
 * Authenticated surfaces (proxy/, ingest/, eval-runs/, …) have their
 * own per-key RPM limit via `recordCallAndCheckRpm` and don't need this.
 *
 * Implementation: per-IP timestamp ring buffer, pruned on each call.
 * The buffer is module-scoped and survives within a single Vercel
 * function instance; cold starts reset the counter — acceptable for
 * the unauth surface since legitimate visitors are far below any cap.
 * A real Redis/KV backend is on the 20-day plan if we see distributed
 * abuse in finals.
 */

const HITS = new Map<string, number[]>()
const WINDOW_MS = 60_000

/**
 * Check-and-record. Returns true when the request is allowed; false
 * when the IP has exceeded `limit` requests in the trailing minute.
 */
export function rateLimitPublic(
  ip: string,
  limit: number,
): { ok: boolean; remaining: number; retryAfter: number } {
  const now = Date.now()
  const cutoff = now - WINDOW_MS
  const bucket = HITS.get(ip) ?? []
  // Prune in place.
  const fresh = bucket.filter((t) => t > cutoff)
  if (fresh.length >= limit) {
    HITS.set(ip, fresh)
    const oldest = fresh[0] ?? now
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)),
    }
  }
  fresh.push(now)
  HITS.set(ip, fresh)
  return {
    ok: true,
    remaining: Math.max(0, limit - fresh.length),
    retryAfter: 0,
  }
}

/**
 * Sweep buckets older than the window. Called opportunistically from
 * the limiter when the Map grows past a soft cap so the function-
 * instance memory doesn't leak under a long-lived attack.
 */
export function maybeSweep(): void {
  if (HITS.size < 10_000) return
  const cutoff = Date.now() - WINDOW_MS
  for (const [ip, hits] of HITS) {
    const fresh = hits.filter((t) => t > cutoff)
    if (fresh.length === 0) HITS.delete(ip)
    else HITS.set(ip, fresh)
  }
}

/**
 * Best-effort caller IP. x-forwarded-for from Vercel includes the
 * client first, then any intermediate proxies. Falls back to "unknown"
 * which still rate-limits but groups all unknowns together (acceptable
 * — legitimate proxied requests usually carry the header).
 */
export function callerIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() ?? 'unknown'
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}
