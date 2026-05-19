import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Shared gate for `/api/admin/*` operations.
 *
 * Reads the secret from `ADMIN_DIAG_TOKEN` env. If unset, the function
 * returns 503 — the route is intentionally disabled rather than falling
 * back to a hardcoded value (the old behavior leaked
 * `'labelhub-diag-2026'` into git history and was discoverable via the
 * docs). Operators must explicitly set the env var to enable admin
 * surfaces, and SHOULD rotate it whenever a former operator leaves.
 *
 * Comparison is timing-safe (constant-time string compare on the digest)
 * to defang naive brute-force.
 */
export function checkAdminToken(
  request: NextRequest,
): NextResponse | null {
  const configured = (process.env.ADMIN_DIAG_TOKEN ?? '').trim()
  if (!configured) {
    return NextResponse.json(
      {
        error: {
          code: 'ADMIN_DISABLED',
          message:
            'Admin endpoints disabled. Set ADMIN_DIAG_TOKEN in env to enable.',
        },
      },
      { status: 503 },
    )
  }
  // 3rd security audit #6 — prefer header over querystring. ?token=
  // landed in Vercel access logs, pg_stat_statements, browser history,
  // and outbound Referer headers. Bearer header is captured by none
  // of those. Keep ?token= as a soft-deprecated fallback (logs a
  // warning) so any in-flight ops scripts don't break.
  const auth = request.headers.get('authorization') ?? ''
  let supplied = ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    supplied = auth.slice(7).trim()
  } else {
    const xToken = request.headers.get('x-admin-token')
    if (xToken) supplied = xToken.trim()
  }
  if (!supplied) {
    const url = new URL(request.url)
    const qsToken = url.searchParams.get('token')
    if (qsToken) {
      supplied = qsToken
      // eslint-disable-next-line no-console
      console.warn(
        '[admin] token supplied via ?token= querystring — deprecated, ' +
          'leaks into logs. Migrate to `Authorization: Bearer <token>`.',
      )
    }
  }
  if (!timingSafeEqual(supplied, configured)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'forbidden' } },
      { status: 403 },
    )
  }
  return null // pass
}

/**
 * Constant-time string compare. Length mismatch returns false immediately,
 * but only after a fixed-length dummy compare to keep the leak band tight.
 *
 * Not perfect against fully-determined attackers (JS strings are
 * variable-time on UTF-16 access at the engine level), but tight enough
 * to make remote brute-force impractical given Vercel's per-IP rate limit.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length, 32)
  let diff = a.length === b.length ? 0 : 1
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}
