import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { getDatasetVersionById } from '@/lib/queries/dataset-versions'
import { AppError } from '@/lib/errors'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import { getDb } from '@/lib/db/client'
import { events } from '@/lib/db/schema'
import {
  reshapeTeaching,
  type TeachingItem,
} from '@/lib/quality/teaching-reshape'

/**
 * GET /api/export/dataset?versionId=...&format=raw|teaching
 *
 * Streams the frozen manifest of a dataset version as JSONL.
 *
 * `format=raw` (default) — one line per manifest entry, full verbatim
 * fields (annotation + topic + task metadata + payload snapshot).
 * Useful for archival / re-import / debugging.
 *
 * `format=teaching` (Phase-18) — only items that carry an
 * `claude_proposal` (i.e. the AI draft-reviewer ran on them), reshaped
 * into the (prompt, ai_proposal, human_correction, delta) triplet
 * that an SFT / DPO training pipeline can ingest without a transform
 * step. Items without an AI proposal are skipped — they're not
 * teaching signals, just labels.
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
    const formatRaw = (url.searchParams.get('format') ?? 'raw').toLowerCase()
    if (formatRaw !== 'raw' && formatRaw !== 'teaching') {
      throw new AppError(
        'VALIDATION_ERROR',
        `Unknown format "${formatRaw}". Use raw or teaching.`,
        400,
      )
    }
    const format = formatRaw as 'raw' | 'teaching'
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

    // 2. Serialize manifest as JSONL. Format chooser:
    //    `raw`      → every manifest entry, verbatim
    //    `teaching` → only entries with claude_proposal, reshaped to
    //                 (prompt, ai_proposal, human_correction, delta)
    const entries: unknown[] =
      format === 'teaching'
        ? version.manifest
            .map(reshapeTeaching)
            .filter((x): x is TeachingItem => x !== null)
        : version.manifest

    const lines = entries.map((it) => JSON.stringify(it)).join('\n')
    responseBytes = Buffer.byteLength(lines, 'utf8')

    const filename = `labelhub-${version.workspaceId.slice(0, 8)}-${version.label}${format === 'teaching' ? '-teaching' : ''}.jsonl`
    response = new Response(lines, {
      status: 200,
      headers: {
        'content-type': 'application/jsonl',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-export-count': String(entries.length),
        'x-version-label': version.label,
        'x-format': format,
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
        format,
        bytes: responseBytes,
        itemCount: entries.length,
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

// Teaching-signal reshape lives in src/lib/quality/teaching-reshape.ts
// so the maintenance-pass unit tests can exercise it without an HTTP
// fixture. See `teaching-reshape.test.ts`.
void ({} as TeachingItem)
