import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { workspaces } from '@/lib/db/schema'
import { getPublicOrigin } from '@/lib/http/public-origin'
import { DEMO_WORKSPACE_ID } from '@/lib/seeds'
import {
  callerIp,
  maybeSweep,
  rateLimitPublic,
} from '@/lib/ratelimit/public-endpoint'

/**
 * GET /api/demo/info → public, no auth.
 *
 * Returns the demo workspace's published API key + rate limit so the
 * landing snippet can show the real, working credential instead of a
 * placeholder. Cached for 60s at the CDN edge.
 *
 * The demo key is intentionally rate-limited (10 RPM, single workspace
 * scope) — see scripts/debug/seed-demo-key.ts for the threat model.
 *
 * Response shape:
 *   {
 *     proxyBase: "https://…/api/proxy",
 *     demoKey:   "lh_demo_…",
 *     demoKeyRpm: 10,
 *     workspaceId: "00000000-…0010",
 *     workspaceUrl: "https://…/workspaces/00000000-…0010",
 *   }
 *
 * Errors gracefully: if the demo key hasn't been minted yet, returns
 * `demoKey: null` so the snippet falls back to its placeholder.
 */

// 30 req/min/IP — the snippet on the landing fetches once per page
// load; the cache-control max-age=60 cap means a single visitor
// hits at most ~1/min. 30 is generous for refresh-spammers and tight
// against a key-rotation scraper.
const DEMO_INFO_RPM = 30

export async function GET(request: Request) {
  const ip = callerIp(request)
  const gate = rateLimitPublic(ip, DEMO_INFO_RPM)
  maybeSweep()
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          'cache-control': 'no-store',
          'retry-after': String(gate.retryAfter),
        },
      },
    )
  }
  const origin = getPublicOrigin(request)

  let demoKey: string | null = null
  let demoKeyRpm: number | null = null
  let mintedAt: string | null = null
  try {
    const db = getDb()
    const [ws] = await db
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, DEMO_WORKSPACE_ID))
      .limit(1)
    const settings = (ws?.settings ?? {}) as {
      demoApiKey?: unknown
      demoApiKeyRpm?: unknown
      demoApiKeyMintedAt?: unknown
    }
    if (typeof settings.demoApiKey === 'string')
      demoKey = settings.demoApiKey
    if (typeof settings.demoApiKeyRpm === 'number')
      demoKeyRpm = settings.demoApiKeyRpm
    if (typeof settings.demoApiKeyMintedAt === 'string')
      mintedAt = settings.demoApiKeyMintedAt
  } catch {
    // Silent fallback — landing snippet still renders without a key.
  }

  return NextResponse.json(
    {
      proxyBase: `${origin}/api/proxy`,
      demoKey,
      demoKeyRpm,
      mintedAt,
      workspaceId: DEMO_WORKSPACE_ID,
      workspaceUrl: `${origin}/workspaces/${DEMO_WORKSPACE_ID}`,
    },
    {
      headers: {
        // Short TTL keeps the key fresh after a rotation but spares
        // every visitor a DB hit.
        'cache-control': 'public, max-age=60, s-maxage=60',
      },
    },
  )
}
