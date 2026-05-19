import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { generateJsonlExport } from '@/lib/actions/export'
import { AppError } from '@/lib/errors'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import { getDb } from '@/lib/db/client'
import { events } from '@/lib/db/schema'

/**
 * GET /api/export/trajectories?workspaceId=...&limit=...&sources=production,eval-run
 *
 * Streams a JSONL file of trajectories + annotations for download.
 * User session auth (admin only). Audit-logged with the export count.
 *
 * Response is `application/jsonl` with Content-Disposition: attachment.
 *
 * Limits: 200 trajectories per call. For larger exports the client should
 * paginate via `?createdBefore=...` and concatenate.
 */
export async function GET(request: NextRequest) {
  const start = Date.now()
  const { userAgent, remoteAddr } = extractRequestMeta(request)

  let workspaceId: string | null = null
  let userId: string | null = null
  let status = 200
  let errorCode: string | null = null
  let response: Response | undefined
  let responseBytes = 0

  try {
    const url = new URL(request.url)
    const workspaceIdParam = url.searchParams.get('workspaceId')
    if (!workspaceIdParam) {
      throw new AppError(
        'VALIDATION_ERROR',
        'workspaceId query param is required.',
        400,
      )
    }
    workspaceId = workspaceIdParam

    const limit = Number(url.searchParams.get('limit') ?? '100')
    const createdBeforeStr = url.searchParams.get('createdBefore')
    const sourcesParam = url.searchParams.get('sources')
    const includeDeleted = url.searchParams.get('includeDeleted') === 'true'

    // Auth
    const { user } = await requireWorkspaceAdmin(workspaceId)
    userId = user.id

    // Generate export
    const result = await generateJsonlExport({
      workspaceId,
      limit: Number.isFinite(limit) ? limit : 100,
      createdBefore: createdBeforeStr
        ? new Date(createdBeforeStr)
        : undefined,
      sources: sourcesParam
        ? sourcesParam.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined,
      includeDeleted,
    })

    responseBytes = result.jsonl.length

    // Audit event (separate from API request log — this is a domain event)
    const db = getDb()
    await db.insert(events).values({
      type: 'export.created',
      workspaceId,
      actorId: user.id,
      payload: {
        count: result.count,
        bytes: responseBytes,
        sources: sourcesParam ?? null,
        includeDeleted,
      },
    })

    const filename = `labelhub-export-${workspaceId.slice(0, 8)}-${Date.now()}.jsonl`
    response = new Response(result.jsonl, {
      status: 200,
      headers: {
        'content-type': 'application/jsonl',
        'content-disposition': `attachment; filename="${filename}"`,
        'x-export-count': String(result.count),
      },
    })
  } catch (e: unknown) {
    if (e instanceof AppError) {
      status = e.status
      errorCode = e.code
      response = NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status },
      )
    } else {
      status = 500
      errorCode = 'INTERNAL'
      const msg = e instanceof Error ? e.message : 'Unknown error'
      // 3rd security audit: never echo DB/internal error text to clients.
      // Log server-side, surface a generic string in the response.
      console.error('[api] internal error:', msg, e instanceof Error ? e.stack : undefined)
      const safeMsg = 'Internal error'
      response = NextResponse.json(
        { error: safeMsg, code: 'INTERNAL' },
        { status: 500 },
      )
    }
  }

  logApiRequest({
    workspaceId,
    userId,
    endpoint: 'GET /api/export/trajectories',
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
