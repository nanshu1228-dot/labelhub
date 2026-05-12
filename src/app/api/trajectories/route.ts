import { NextResponse, type NextRequest } from 'next/server'
import { authenticateApiKey } from '@/lib/auth/api-key'
import { AppError } from '@/lib/errors'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import { searchTrajectories } from '@/lib/queries/trajectories'
import { TRAJECTORY_SOURCES, type TrajectorySource } from '@/lib/trajectories/schema'

/**
 * GET /api/trajectories
 *
 * Read-side surface: list trajectories captured for a workspace, optionally
 * filtered. Workspace API key auth (`Authorization: Bearer lh_ws_...` or
 * `x-api-key: lh_ws_...`).
 *
 * Query params:
 *   ?agent=<substring>           ILIKE filter on agentName
 *   ?source=production,eval-run  comma-separated allow-list
 *   ?limit=50                    max 200
 *   ?offset=0
 *   ?createdAfter=ISO            inclusive lower bound
 *   ?createdBefore=ISO           exclusive upper bound
 *
 * Returns: `{ trajectories: [...], total, hasMore, limit, offset }`. Each
 * trajectory row is the full DB row — meta (including qcFlags), source,
 * agentName, rootPrompt, finalResponse, createdAt, etc. Steps are NOT
 * inlined — fetch `/api/trajectories/[id]` for that.
 *
 * Why the workspace is inferred from the API key (not a query param): keys
 * are workspace-scoped, so the workspace is implicit. Cross-workspace reads
 * require multiple keys.
 */
export async function GET(request: NextRequest) {
  const start = Date.now()
  const { userAgent, remoteAddr } = extractRequestMeta(request)
  let workspaceId: string | null = null
  let apiKeyId: string | null = null
  let status = 200
  let errorCode: string | null = null
  let response: NextResponse | undefined
  let responseBytes = 0

  try {
    const auth = await authenticateApiKey(request)
    if ('error' in auth) throw new AppError(auth.code, auth.error, 401)
    workspaceId = auth.workspaceId
    apiKeyId = auth.apiKeyId

    const url = new URL(request.url)
    const agentName = url.searchParams.get('agent') ?? undefined
    const sourcesParam = url.searchParams.get('source')
    const limit = Math.min(
      Math.max(Number(url.searchParams.get('limit') ?? '50') || 50, 1),
      200,
    )
    const offset = Math.max(
      Number(url.searchParams.get('offset') ?? '0') || 0,
      0,
    )
    const createdAfterStr = url.searchParams.get('createdAfter')
    const createdBeforeStr = url.searchParams.get('createdBefore')

    const sourceList = sourcesParam
      ? (sourcesParam.split(',').map((s) => s.trim()) as TrajectorySource[]).filter(
          (s): s is TrajectorySource =>
            (TRAJECTORY_SOURCES as readonly string[]).includes(s),
        )
      : undefined

    const result = await searchTrajectories({
      workspaceId,
      filters: {
        agentName,
        source: sourceList,
        createdAfter: createdAfterStr ? new Date(createdAfterStr) : undefined,
        createdBefore: createdBeforeStr ? new Date(createdBeforeStr) : undefined,
      },
      limit,
      offset,
    })

    const body = JSON.stringify({
      trajectories: result.trajectories,
      total: result.total,
      hasMore: result.hasMore,
      limit: result.limit,
      offset: result.offset,
    })
    responseBytes = body.length
    response = new NextResponse(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e: unknown) {
    if (e instanceof AppError) {
      status = e.status
      errorCode = e.code
      response = NextResponse.json(
        { error: { message: e.message, code: e.code } },
        { status: e.status },
      )
    } else {
      status = 500
      errorCode = 'INTERNAL'
      const msg = e instanceof Error ? e.message : 'Unknown error'
      response = NextResponse.json(
        { error: { message: msg, code: 'INTERNAL' } },
        { status: 500 },
      )
    }
  }

  logApiRequest({
    workspaceId,
    apiKeyId,
    endpoint: 'GET /api/trajectories',
    method: 'GET',
    status,
    errorCode,
    durationMs: Date.now() - start,
    remoteAddr,
    userAgent,
    responseBytes,
  })

  return response!
}
