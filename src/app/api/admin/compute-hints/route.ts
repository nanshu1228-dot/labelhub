import { NextResponse } from 'next/server'
import { reviewTrajectoryAndCache } from '@/lib/actions/trajectory-hints'

/**
 * POST /api/admin/compute-hints?token=...&trajectoryId=...
 *
 * Synchronous trajectory-hint cache fill. The `after()` path in /annotate
 * is async-fire-and-forget, which works on Vercel but the after-window
 * isn't always generous — when running 5 jobs back-to-back, some can be
 * cut short. This endpoint runs the same code path INSIDE the request
 * lifetime so we can:
 *
 *   - see the actual error if it fails
 *   - retry-by-curl until success
 *   - pre-seed the demo workspace before a demo
 *
 * Token-gated (ADMIN_DIAG_TOKEN env, falls back to a hardcoded demo
 * value). Returns the hint count + the actual error message on failure.
 */

const ADMIN_TOKEN = process.env.ADMIN_DIAG_TOKEN ?? 'labelhub-diag-2026'

export const maxDuration = 60

export async function POST(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('token') !== ADMIN_TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const trajectoryId = url.searchParams.get('trajectoryId')
  if (!trajectoryId) {
    return NextResponse.json(
      { error: 'missing trajectoryId query param' },
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
      error: result.error,
    })
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        trajectoryId,
        error: e instanceof Error ? e.message : 'unknown error',
        stack: e instanceof Error ? e.stack?.split('\n').slice(0, 5) : null,
      },
      { status: 500 },
    )
  }
}

// Convenience: GET also works for browser pasting.
export async function GET(request: Request) {
  return POST(request)
}
