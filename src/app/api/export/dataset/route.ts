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
import {
  isExportFormat,
  pickFormatterFor,
  type ExportFormat,
} from '@/lib/export/formatters'

/**
 * GET /api/export/dataset?versionId=...&format=raw|teaching&encoding=json|jsonl|csv|excel
 *
 * Streams the frozen manifest of a dataset version. Two orthogonal
 * controls:
 *
 *   `format` (content shape)
 *     - `raw` (default) — one entry per manifest row, full verbatim
 *       fields (annotation + topic + task metadata + payload).
 *     - `teaching` (Phase-18) — only entries with claude_proposal,
 *       reshaped to (prompt, ai_proposal, human_correction, delta)
 *       so an SFT / DPO pipeline can ingest without a transform.
 *
 *   `encoding` (Finals D15 — output file format)
 *     - `jsonl` (default; identical to the original route behavior)
 *     - `json`  (single array document)
 *     - `csv`   (RFC 4180 with formula-injection defense)
 *     - `excel` (.xlsx via SheetJS; buffered, not streamed)
 *
 * Auth: admin of the version's workspace. The version row's
 * workspace is resolved BEFORE the admin gate so a cross-workspace
 * versionId still hits the workspace-scoped guard.
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
    // D15 — output encoding parameter. Defaults to jsonl so the
    // route's pre-finals contract is preserved.
    const encodingRaw = (
      url.searchParams.get('encoding') ?? 'jsonl'
    ).toLowerCase()
    if (!isExportFormat(encodingRaw)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Unknown encoding "${encodingRaw}". Use json, jsonl, csv, or excel.`,
        400,
      )
    }
    const encoding: ExportFormat = encodingRaw
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

    // 2. Project the manifest into content-shape rows.
    //    `raw`      → every manifest entry, verbatim
    //    `teaching` → only entries with claude_proposal, reshaped to
    //                 (prompt, ai_proposal, human_correction, delta)
    const entries: Record<string, unknown>[] = (
      format === 'teaching'
        ? version.manifest
            .map(reshapeTeaching)
            .filter((x): x is TeachingItem => x !== null)
        : version.manifest
    ) as Record<string, unknown>[]

    // D15 — pick the encoding's formatter and buffer its bytes for
    // logging + response. Excel must buffer (sheetjs doesn't stream);
    // the others are streaming-shape async iterators but we still
    // collect for the response body so the x-export-count header
    // remains a single shot. Streaming directly to Response.body
    // would need a chunked-aware Response; deferring that to D18.
    const formatter = pickFormatterFor(encoding)

    async function* rowIterator() {
      for (const entry of entries) yield entry
    }
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    for await (const chunk of formatter(rowIterator())) {
      chunks.push(chunk)
      totalBytes += chunk.length
    }
    const body = new Uint8Array(totalBytes)
    let offset = 0
    for (const c of chunks) {
      body.set(c, offset)
      offset += c.length
    }
    responseBytes = totalBytes

    const extLabel = format === 'teaching' ? '-teaching' : ''
    const filename = `labelhub-${version.workspaceId.slice(0, 8)}-${version.label}${extLabel}.${formatter.meta.extension}`
    response = new Response(body, {
      status: 200,
      headers: {
        'content-type': formatter.meta.contentType,
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-export-count': String(entries.length),
        'x-version-label': version.label,
        'x-format': format,
        'x-encoding': encoding,
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
        encoding,
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
