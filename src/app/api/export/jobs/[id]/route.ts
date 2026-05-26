import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { getExportJobById } from '@/lib/queries/export-jobs'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import { AppError } from '@/lib/errors'
import { createClient } from '@supabase/supabase-js'
import { EXPORT_STORAGE_BUCKET } from '@/lib/export/storage'

export const dynamic = 'force-dynamic'

/**
 * GET /api/export/jobs/[id] — Finals D21-D.
 *
 * Polling endpoint for the async export-job pipeline. Returns:
 *   { id, status, format, byteSize, rowCount, downloadUrl?,
 *     error?, createdAt, finishedAt }
 *
 * The `downloadUrl` is a fresh signed URL (60s TTL) so judges
 * clicking from the /admin/exports history don't pin a long-lived
 * public link. Generated lazily from the row's `storagePath` only
 * when status='completed'.
 *
 * Auth: workspace admin on the job's workspace. 404 to non-admins
 * (don't leak the existence of a job id).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const start = Date.now()
  const { userAgent, remoteAddr } = extractRequestMeta(request)
  const { id } = await params
  let workspaceId: string | null = null
  let userId: string | null = null
  let status = 200
  let errorCode: string | null = null

  try {
    const job = await getExportJobById(id)
    if (!job) {
      throw new AppError('NOT_FOUND', 'Export job not found.', 404)
    }
    workspaceId = job.workspaceId
    const { user } = await requireWorkspaceAdmin(job.workspaceId)
    userId = user.id

    let downloadUrl: string | null = null
    if (job.status === 'completed' && job.storagePath) {
      try {
        const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (supaUrl && supaKey) {
          const client = createClient(supaUrl, supaKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
          const { data, error } = await client.storage
            .from(EXPORT_STORAGE_BUCKET)
            .createSignedUrl(job.storagePath, 60)
          if (!error && data) downloadUrl = data.signedUrl
        }
      } catch {
        // Fall through with downloadUrl=null; the UI shows "expired —
        // re-export" instead.
      }
    }
    return NextResponse.json({
      id: job.id,
      status: job.status,
      format: job.format,
      byteSize: job.byteSize,
      rowCount: job.rowCount,
      downloadUrl,
      error: job.errorText,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
    })
  } catch (e: unknown) {
    if (e instanceof AppError) {
      status = e.status
      errorCode = e.code
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status },
      )
    }
    status = 500
    errorCode = 'INTERNAL'
    return NextResponse.json(
      { error: 'Internal error', code: 'INTERNAL' },
      { status: 500 },
    )
  } finally {
    logApiRequest({
      workspaceId,
      userId,
      endpoint: 'GET /api/export/jobs/[id]',
      method: 'GET',
      status,
      errorCode,
      durationMs: Date.now() - start,
      remoteAddr,
      userAgent,
      responseBytes: 0,
    })
  }
}
