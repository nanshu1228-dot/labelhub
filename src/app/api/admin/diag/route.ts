import { NextResponse } from 'next/server'

/**
 * GET /api/admin/diag — env-presence diagnostic.
 *
 * Returns which AI provider env vars are present (non-empty) in this
 * deploy's runtime. Used for one-off "why isn't Claude hint working"
 * debugging — read-only, never leaks the key value.
 *
 * Gated behind a query token to discourage drive-by probing. The token
 * is shared with the team out-of-band (not the API).
 */

const ADMIN_TOKEN = process.env.ADMIN_DIAG_TOKEN ?? 'labelhub-diag-2026'

function check(envName: string): { name: string; set: boolean; len: number } {
  const v = process.env[envName]
  return {
    name: envName,
    set: !!(v && v.trim().length > 0),
    len: v ? v.length : 0,
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('token') !== ADMIN_TOKEN) {
    return NextResponse.json(
      { error: 'forbidden' },
      { status: 403 },
    )
  }
  return NextResponse.json({
    providers: [
      check('ANTHROPIC_API_KEY'),
      check('DOUBAO_API_KEY'),
      check('DEEPSEEK_API_KEY'),
      check('MOONSHOT_API_KEY'),
      check('QWEN_API_KEY'),
      check('OPENAI_API_KEY'),
    ],
    // Auth-related env. NEXT_PUBLIC_* must be available at BUILD time
    // for Next to inline them into the client bundle — set them in Vercel
    // BEFORE the build, then redeploy.
    auth: [
      check('NEXT_PUBLIC_SUPABASE_URL'),
      check('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      check('SUPABASE_SERVICE_ROLE_KEY'),
    ],
    config: {
      AI_DEFAULT_PROVIDER: process.env.AI_DEFAULT_PROVIDER ?? null,
      LABELHUB_DEMO_MODE: process.env.LABELHUB_DEMO_MODE ?? null,
    },
    runtime: {
      VERCEL_ENV: process.env.VERCEL_ENV ?? null,
      VERCEL_REGION: process.env.VERCEL_REGION ?? null,
    },
  })
}
