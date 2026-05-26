import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getStorageDriver, uploadToLocalFs } from '@/lib/storage/local-fs'

/**
 * Export-artifact storage — Finals D21-D.
 *
 * Uploads async export artifacts (the > 5MB job path) to Supabase
 * Storage at a workspace-scoped path. Public URL returned for the
 * download button in `/admin/exports`.
 *
 * Separate bucket / path-prefix from the proxy's `labelhub-media`
 * (which holds annotation attachments). Reuses the same env vars
 * (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) so no
 * new ops configuration.
 */

export const EXPORT_STORAGE_BUCKET = 'labelhub-exports'

let _client: SupabaseClient | null = null

function getExportClient(): SupabaseClient | null {
  if (_client) return _client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _client
}

export interface ExportUploadResult {
  publicUrl: string
  path: string
}

/**
 * Upload an export-job artifact. Path:
 *   exports/{workspaceId}/{jobId}.{ext}
 *
 * `upsert: true` because the same jobId should idempotently
 * overwrite (e.g. a retry of a failed job that produces a fresh
 * artifact). Caller passes the conventional ext (jsonl/json/csv/
 * xlsx) from the formatter's `.meta.extension`.
 *
 * Throws on missing env / upload failure — the async export-job
 * handler catches + marks the row failed.
 */
export async function uploadExportArtifact(opts: {
  workspaceId: string
  jobId: string
  ext: string
  bytes: Uint8Array
  contentType: string
}): Promise<ExportUploadResult> {
  const key = `${opts.workspaceId}/${opts.jobId}.${opts.ext}`

  // D22 self-host — local FS driver. Writes to /var/labelhub/storage/
  // and returns a URL nginx serves directly. Picked via env so the
  // Vercel deploy (driver=supabase, default) keeps working.
  if (getStorageDriver() === 'local') {
    const { publicUrl, path: writtenKey } = await uploadToLocalFs({
      bucket: EXPORT_STORAGE_BUCKET,
      key,
      bytes: opts.bytes,
      contentType: opts.contentType,
    })
    return { publicUrl, path: writtenKey }
  }

  // Supabase Storage path (Vercel default).
  const client = getExportClient()
  if (!client) {
    throw new Error('Supabase Storage not configured (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)')
  }
  const { error } = await client.storage
    .from(EXPORT_STORAGE_BUCKET)
    .upload(key, opts.bytes, {
      contentType: opts.contentType,
      upsert: true,
    })
  if (error) {
    throw new Error(`Export storage upload failed: ${error.message}`)
  }
  const { data } = client.storage
    .from(EXPORT_STORAGE_BUCKET)
    .getPublicUrl(key)
  return { publicUrl: data.publicUrl, path: key }
}

/**
 * Pure: estimate the byte size of a dataset before formatting.
 * Used by the export route to decide between sync streaming + async
 * job-queue paths. Heuristic — overestimates short-string-heavy
 * datasets, underestimates wide rows; the 5MB threshold has
 * generous margin.
 */
export function estimateExportBytes(opts: {
  itemCount: number
  /** Average row size in bytes when serialized. Defaults to 2KB. */
  avgBytesPerRow?: number
}): number {
  return opts.itemCount * (opts.avgBytesPerRow ?? 2_000)
}

/**
 * D21-D threshold: 5_000_000 bytes (~5MB after compression). Above
 * this we enqueue an export_jobs row and process in the after()
 * window; below this the route streams the bytes directly to the
 * client.
 */
export const ASYNC_EXPORT_THRESHOLD_BYTES = 5_000_000
