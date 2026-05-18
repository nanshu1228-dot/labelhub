import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { workspaces } from '@/lib/db/schema'

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

const DEMO_WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'

export async function GET(request: Request) {
  const origin = new URL(request.url).origin

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
