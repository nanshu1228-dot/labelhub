import 'server-only'

/**
 * Supabase Storage uploader for proxy-captured attachments.
 *
 * Multimodal requests carry images / PDFs / audio inline (base64) or by
 * remote URL. URLs we already store as-is. Base64 inline blobs need a home
 * if we want the annotator to actually view them — and the home is a
 * Supabase Storage bucket called `labelhub-media`.
 *
 * Architecture:
 *   - The proxy's `after()` callback runs this AFTER the response is sent.
 *     Uploads never block the user-facing request.
 *   - **Content-addressable** path: `<workspaceId>/<sha256>.<ext>`. Two
 *     identical images uploaded from two workspaces de-dupe within each
 *     workspace; cross-workspace isolation is preserved by the path prefix.
 *   - Storage failures degrade gracefully: the attachment stays in DB with
 *     `source: 'base64-inline'` (no URL) — same as if Storage were
 *     unconfigured. The capture is not lost.
 *
 * Bucket setup (one-time, in Supabase dashboard):
 *   1. Storage → New bucket → name = `labelhub-media`
 *   2. Public bucket (URLs are unguessable due to sha256; ok for demo)
 *   3. (Optional) file size limit: 10 MB
 *   4. RLS off (we use service-role key, bypassing RLS)
 *
 * .env.local must have `SUPABASE_SERVICE_ROLE_KEY` AND
 * `NEXT_PUBLIC_SUPABASE_URL` set. Without these the upload silently no-ops.
 */

import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AttachmentRecord } from './attachment-extractor'
import { getStorageDriver, uploadToLocalFs } from '@/lib/storage/local-fs'

export const STORAGE_BUCKET = 'labelhub-media'

let _client: SupabaseClient | null = null

/**
 * Lazy Supabase service-role client. Returns null when env is missing —
 * caller checks and falls back to metadata-only capture.
 */
function getStorageClient(): SupabaseClient | null {
  if (_client) return _client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _client
}

/** Convenience: is storage actually wired up right now? */
export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}

/**
 * Map a mime type to a sensible file extension.
 * Falls back to 'bin' for unknown types — content-hash filename still works.
 */
function extensionFor(mime: string | undefined): string {
  if (!mime) return 'bin'
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
    'audio/wav': 'wav',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
  }
  return map[mime] ?? mime.split('/')[1]?.split('+')[0] ?? 'bin'
}

export interface UploadResult {
  /** Public URL to the stored blob. */
  publicUrl: string
  /** Object path within the bucket. */
  path: string
  /** Was it already there (dedup hit)? */
  reused: boolean
}

/**
 * Upload a single byte buffer. Returns the public URL.
 *
 * Errors are PROPAGATED — caller's responsibility to swallow + degrade.
 * Reason: a bucket misconfiguration should surface in logs immediately,
 * not be silently lost.
 */
export async function uploadBytes(opts: {
  workspaceId: string
  bytes: Buffer
  mediaType?: string
}): Promise<UploadResult> {
  const sha = createHash('sha256').update(opts.bytes).digest('hex')
  const ext = extensionFor(opts.mediaType)
  const path = `${opts.workspaceId}/${sha}.${ext}`

  // D22 self-host — local FS driver. Content-addressed dedupe via
  // sha256 → identical bytes reuse the same on-disk file (the second
  // writeFile is a no-op overwrite with the same content). Reuse
  // detection: stat before write.
  if (getStorageDriver() === 'local') {
    const { stat } = await import('node:fs/promises')
    const path2 = await import('node:path')
    const root = process.env.LOCAL_STORAGE_DIR || '/var/labelhub/storage'
    const baseUrl = (
      process.env.LOCAL_STORAGE_BASE_URL || '/storage'
    ).replace(/\/+$/, '')
    const fullPath = path2.join(root, STORAGE_BUCKET, path)
    let reused = false
    try {
      await stat(fullPath)
      reused = true
    } catch {
      // not present → upload
    }
    if (!reused) {
      await uploadToLocalFs({
        bucket: STORAGE_BUCKET,
        key: path,
        bytes: opts.bytes,
        contentType: opts.mediaType,
      })
    }
    return {
      publicUrl: `${baseUrl}/${STORAGE_BUCKET}/${path}`,
      path,
      reused,
    }
  }

  // Supabase Storage path (Vercel default).
  const client = getStorageClient()
  if (!client) {
    throw new Error('Supabase Storage not configured')
  }

  const { error } = await client.storage.from(STORAGE_BUCKET).upload(
    path,
    opts.bytes,
    {
      contentType: opts.mediaType ?? 'application/octet-stream',
      // `upsert: false` — we DON'T overwrite an existing object. Content-
      // addressable paths mean a hit is the SAME bytes by definition.
      upsert: false,
    },
  )
  const reused =
    error?.message?.toLowerCase().includes('already exists') ||
    error?.message?.toLowerCase().includes('duplicate') ||
    false
  if (error && !reused) {
    throw new Error(`Storage upload failed: ${error.message}`)
  }

  const { data } = client.storage.from(STORAGE_BUCKET).getPublicUrl(path)
  return { publicUrl: data.publicUrl, path, reused }
}

/**
 * Upload every base64-inline attachment in the list. Returns a NEW array
 * with `source` changed to `storage` and `url` populated for successful
 * uploads. Failures keep the original record (still surfaces metadata).
 *
 * Mutates the input array's records' `_rawData` field to `undefined` so
 * callers can't accidentally persist raw bytes to the trajectories table.
 */
export async function uploadAttachmentsToStorage(opts: {
  workspaceId: string
  attachments: AttachmentRecord[]
}): Promise<AttachmentRecord[]> {
  if (!isStorageConfigured()) {
    // Strip raw bytes before returning (privacy + size).
    return opts.attachments.map(({ _rawData, ...rest }) => {
      void _rawData
      return rest
    })
  }

  const out: AttachmentRecord[] = []
  for (const a of opts.attachments) {
    if (a.source !== 'base64-inline' || !a._rawData) {
      // url-based or already-uploaded: keep as-is, strip any stray bytes
      const { _rawData, ...rest } = a
      void _rawData
      out.push(rest)
      continue
    }
    try {
      const result = await uploadBytes({
        workspaceId: opts.workspaceId,
        bytes: a._rawData,
        mediaType: a.mediaType,
      })
      const { _rawData, ...rest } = a
      void _rawData
      out.push({
        ...rest,
        source: 'storage',
        url: result.publicUrl,
      })
    } catch (e) {
      // Log + keep the metadata-only record. Capture is never blocked by
      // storage failures.
      // eslint-disable-next-line no-console
      console.warn(
        'storage: failed to upload attachment',
        a.hashPrefix,
        e instanceof Error ? e.message : e,
      )
      const { _rawData, ...rest } = a
      void _rawData
      out.push(rest)
    }
  }
  return out
}
