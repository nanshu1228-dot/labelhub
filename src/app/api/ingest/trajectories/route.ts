import { NextResponse, type NextRequest } from 'next/server'
import { authenticateApiKey } from '@/lib/auth/api-key'
import { ingestTrajectory } from '@/lib/trajectories/ingest'
import {
  type DetectedFormat,
  detectFormat,
} from '@/lib/trajectories/detect'
import { TRAJECTORY_SOURCES, type TrajectorySource } from '@/lib/trajectories/schema'
import { AppError } from '@/lib/errors'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'

/**
 * POST /api/ingest/trajectories
 *
 * Production SDK ingest endpoint. Workspace API key auth via Bearer header.
 * Every call audit-logged to `api_request_log` (success + failure).
 */
export async function POST(request: NextRequest) {
  const start = Date.now()
  const { userAgent, remoteAddr } = extractRequestMeta(request)

  let workspaceId: string | null = null
  let apiKeyId: string | null = null
  let status = 200
  let errorCode: string | null = null
  let response: NextResponse | undefined
  let payloadBytes = 0

  try {
    // Read body as text first so we can record its size; then parse.
    const bodyText = await request.text()
    payloadBytes = bodyText.length

    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new AppError('BAD_JSON', 'Body is not valid JSON.', 400)
    }

    // ── Auth ───────────────────────────────────────────────────────────
    const auth = await authenticateApiKey(request)
    if ('error' in auth) {
      throw new AppError(auth.code, auth.error, 401)
    }
    workspaceId = auth.workspaceId
    apiKeyId = auth.apiKeyId

    // ── Headers ────────────────────────────────────────────────────────
    const agentName =
      request.headers.get('x-labelhub-agent-name') ?? 'unnamed-agent'
    const sourceHeader = (request.headers.get('x-labelhub-source') ??
      'production') as string
    const source: TrajectorySource = (
      TRAJECTORY_SOURCES as readonly string[]
    ).includes(sourceHeader)
      ? (sourceHeader as TrajectorySource)
      : 'production'

    const formatOverride = request.headers.get('x-labelhub-format') as
      | DetectedFormat
      | null
    const format = formatOverride ?? detectFormat(body)

    if (format === 'unknown') {
      throw new AppError(
        'UNKNOWN_FORMAT',
        'Could not detect trajectory format. Supply X-LabelHub-Format header or use canonical schema.',
        400,
      )
    }

    // ── Ingest ─────────────────────────────────────────────────────────
    const result = await ingestTrajectory({
      workspaceId: auth.workspaceId,
      agentName,
      source,
      format,
      actorId: null,
      payload: body,
    })

    status = 202
    response = NextResponse.json(
      {
        ok: true,
        trajectoryId: result.trajectoryId,
        stepCount: result.stepCount,
        format: result.format,
        providersInferred: result.providersInferred,
      },
      { status: 202 },
    )
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
      response = NextResponse.json(
        { error: msg, code: 'INTERNAL' },
        { status: 500 },
      )
    }
  }

  // Fire-and-forget audit log.
  logApiRequest({
    workspaceId,
    apiKeyId,
    endpoint: 'POST /api/ingest/trajectories',
    method: 'POST',
    status,
    errorCode,
    durationMs: Date.now() - start,
    remoteAddr,
    userAgent,
    payloadBytes,
  })

  return response!
}
