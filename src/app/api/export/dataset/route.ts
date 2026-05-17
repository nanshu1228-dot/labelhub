import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { getDatasetVersionById } from '@/lib/queries/dataset-versions'
import { AppError } from '@/lib/errors'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import { getDb } from '@/lib/db/client'
import { events } from '@/lib/db/schema'

/**
 * GET /api/export/dataset?versionId=...
 *
 * Streams the frozen manifest of a dataset version as JSONL. One line
 * per item; each line is the manifest entry verbatim (annotation +
 * topic + task metadata + payload snapshot).
 *
 * Format chosen for HuggingFace dataset compatibility (load as JSON
 * lines). Read-only — the manifest is immutable so this endpoint can
 * cache aggressively on the CDN; we still set no-cache to be safe
 * because the row gates on admin auth.
 *
 * Auth: admin of the version's workspace. We resolve the version
 * first so the admin gate is correctly scoped to the row's workspace
 * (a cross-workspace versionId leaks no data because the auth check
 * happens before we serialize the manifest).
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
    const versionId = url.searchParams.get('versionId')
    if (!versionId) {
      throw new AppError(
        'VALIDATION_ERROR',
        'versionId query param is required.',
        400,
      )
    }

    // 1. Load the version row by id. Don't expose the manifest yet —
    //    we need to confirm the caller is admin of THIS row's
    //    workspace before streaming bytes.
    const version = await getDatasetVersionById(versionId)
    if (!version) {
      throw new AppError(
        'NOT_FOUND',
        'Dataset version not found.',
        404,
      )
    }
    workspaceId = version.workspaceId

    const { user } = await requireWorkspaceAdmin(version.workspaceId)
    userId = user.id

    // 2. Serialize manifest as JSONL — one line per item. We can't
    //    re-use a SSE/stream pipe here because the manifest is already
    //    a parsed JSON array in memory; flushing line-by-line gives
    //    nothing over flushing the whole buffer. For very large
    //    versions (5k items × 5KB ≈ 25MB) we'd switch to a chunked
    //    Reader; current MVP keeps it simple.
    const lines = version.manifest
      .map((it) => JSON.stringify(it))
      .join('\n')
    responseBytes = Buffer.byteLength(lines, 'utf8')

    const filename = `labelhub-${version.workspaceId.slice(0, 8)}-${version.label}.jsonl`
    response = new Response(lines, {
      status: 200,
      headers: {
        'content-type': 'application/jsonl',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-export-count': String(version.itemCount),
        'x-version-label': version.label,
      },
    })

    // 3. Audit event — re-downloads of a version are tracked so
    //    admins can see "Bob exported v3 yesterday".
    const db = getDb()
    await db.insert(events).values({
      type: 'dataset.version_exported',
      workspaceId: version.workspaceId,
      actorId: user.id,
      payload: {
        versionId: version.id,
        label: version.label,
        bytes: responseBytes,
        itemCount: version.itemCount,
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
      response = NextResponse.json(
        { error: msg, code: 'INTERNAL' },
        { status: 500 },
      )
    }
  }

  logApiRequest({
    workspaceId,
    userId,
    endpoint: 'GET /api/export/dataset',
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
