import { NextResponse, type NextRequest } from 'next/server'
import { authenticateApiKey } from '@/lib/auth/api-key'
import { AppError } from '@/lib/errors'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import {
  listAnnotationsForApi,
  type ApiAnnotationStatus,
} from '@/lib/queries/annotations-api'

/**
 * GET /api/annotations
 *
 * Customer-facing read of annotation results. Workspace API key auth.
 *
 * Query params:
 *   ?trajectory_id=<uuid>             filter to a single trajectory
 *   ?status=approved|rejected|...     filter by current topic state
 *   ?since=<iso>                      inclusive lower bound on submittedAt
 *   ?until=<iso>                      exclusive upper bound on submittedAt
 *   ?limit=50                         clamped to [1, 200]
 *   ?offset=0
 *
 * Response (200):
 *   {
 *     annotations: [{
 *       id, trajectoryId, userId, userEmail, userDisplayName, status,
 *       submittedAt, reviewVerdict, reviewFeedback, reviewedAt,
 *       trajectoryMarks: { [rubricId]: Mark },
 *       stepMarks: { [stepId]: { [rubricId]: Mark } }
 *     }, ...],
 *     total, limit, offset, hasMore
 *   }
 *
 * Workspace is inferred from the API key — cross-workspace reads need
 * separate keys.
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
    const trajectoryIdRaw = url.searchParams.get('trajectory_id') ?? undefined
    // Phase-6 audit response: validate UUID shape on the trajectory_id
    // query param before it flows into the query layer. Auth would
    // still catch a cross-workspace forge attempt, but failing fast on
    // shape gives a cleaner 400 + protects the downstream code from
    // arbitrary string input.
    const trajectoryId =
      trajectoryIdRaw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trajectoryIdRaw)
        ? trajectoryIdRaw
        : trajectoryIdRaw
          ? (() => {
              throw new AppError(
                'BAD_TRAJECTORY_ID',
                'trajectory_id must be a UUID',
                400,
              )
            })()
          : undefined
    const statusParam = url.searchParams.get('status') ?? undefined
    const since = url.searchParams.get('since') ?? undefined
    const until = url.searchParams.get('until') ?? undefined
    const limit = Math.min(
      Math.max(Number(url.searchParams.get('limit') ?? '50') || 50, 1),
      200,
    )
    const offset = Math.max(
      Number(url.searchParams.get('offset') ?? '0') || 0,
      0,
    )

    // Only known statuses get passed through; bogus values silently dropped.
    const KNOWN_STATUSES: readonly ApiAnnotationStatus[] = [
      'drafting',
      'revising',
      'submitted',
      'reviewing',
      'approved',
      'rejected',
    ]
    const statusFilter: ApiAnnotationStatus | undefined =
      statusParam && (KNOWN_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as ApiAnnotationStatus)
        : undefined

    const result = await listAnnotationsForApi({
      workspaceId,
      trajectoryId,
      status: statusFilter,
      since,
      until,
      limit,
      offset,
    })

    const body = JSON.stringify(result)
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
    endpoint: 'GET /api/annotations',
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
