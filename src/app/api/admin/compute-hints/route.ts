import { NextResponse, type NextRequest } from 'next/server'
import { reviewTrajectoryAndCache } from '@/lib/actions/trajectory-hints'
import { checkAdminToken } from '@/lib/auth/admin-token'

/**
 * POST /api/admin/compute-hints?token=...&trajectoryId=...
 *
 * Synchronous trajectory-hint cache fill. The `after()` path in /annotate
 * is async-fire-and-forget, which works on Vercel but the after-window
 * isn't always generous — when running 5 jobs back-to-back, some can be
 * cut short. This endpoint runs the same code path INSIDE the request
 * lifetime so we can:
 *
 *   - retry-by-curl until success
 *   - pre-seed the demo workspace before a demo
 *
 * Auth: token-gated via `ADMIN_DIAG_TOKEN` env (required, no fallback).
 * Errors return a generic 500 with code only — stack traces stay in
 * server logs, NEVER reach the client (used to leak DB schema + paths).
 */

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const block = checkAdminToken(request)
  if (block) return block
  const url = new URL(request.url)
  const trajectoryId = url.searchParams.get('trajectoryId')
  if (!trajectoryId) {
    return NextResponse.json(
      { error: { code: 'MISSING_PARAM', message: 'missing trajectoryId' } },
      { status: 400 },
    )
  }

  try {
    const result = await reviewTrajectoryAndCache({ trajectoryId })
    if ('hints' in result) {
      return NextResponse.json({
        ok: true,
        trajectoryId,
        hintCount: result.hints.length,
        sample: result.hints[0] ?? null,
      })
    }
    return NextResponse.json({
      ok: false,
      trajectoryId,
      // result.error is from our own code paths (NotFound / validation
      // failures), safe to surface. Provider errors get sanitized inside
      // reviewTrajectoryAndCache before bubbling here.
      error: { code: 'COMPUTE_FAILED', message: result.error },
    })
  } catch (e) {
    // Log full stack server-side; return generic message to caller. The
    // old behavior returned stack frames + e.message verbatim, which
    // leaked module paths and DB constraint names.
    // eslint-disable-next-line no-console
    console.error(
      '[admin/compute-hints] internal error:',
      e instanceof Error ? e.stack ?? e.message : e,
    )
    return NextResponse.json(
      {
        ok: false,
        trajectoryId,
        error: {
          code: 'INTERNAL',
          message:
            'Compute failed. Check server logs for the underlying error.',
        },
      },
      { status: 500 },
    )
  }
}

// Convenience: GET also works for browser pasting.
export async function GET(request: NextRequest) {
  return POST(request)
}
