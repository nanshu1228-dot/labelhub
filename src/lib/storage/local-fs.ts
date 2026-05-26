import 'server-only'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Local filesystem storage driver — Finals self-host.
 *
 * Writes uploaded bytes to a directory tree under `LOCAL_STORAGE_DIR`
 * (defaults to `/var/labelhub/storage`). Returns the public URL via
 * `LOCAL_STORAGE_BASE_URL` (e.g. `https://aipert.top/storage`), which
 * nginx serves directly via:
 *
 *   location /storage/ { alias /var/labelhub/storage/; }
 *
 * Why driver-level (vs adapter per-call site): the proxy attachments
 * (`labelhub-media`) and the export artifacts (`labelhub-exports`)
 * both want the same write semantics — a single helper keeps the
 * code DRY across `src/lib/proxy/storage.ts` + `src/lib/export/storage.ts`.
 *
 * Switching: set `STORAGE_DRIVER=local` in env. Default is `supabase`
 * (zero regression for Vercel deployments).
 */

export interface LocalUploadInput {
  /**
   * Logical bucket — mirrors the Supabase bucket name.
   * Common values: 'labelhub-media' / 'labelhub-exports'.
   */
  bucket: string
  /** Path relative to the bucket — same shape as Supabase storage paths. */
  key: string
  bytes: Uint8Array | Buffer
  contentType?: string
}

export interface LocalUploadResult {
  /**
   * Public URL nginx will serve. Includes `LOCAL_STORAGE_BASE_URL`
   * prefix + bucket + key. Same shape as Supabase's `publicUrl`.
   */
  publicUrl: string
  /**
   * Path within the bucket (i.e. `key`). Same shape as Supabase's
   * `path`. Used as the storage_path column in `export_jobs`.
   */
  path: string
}

/**
 * Returns the configured driver kind. Default 'supabase' for back-
 * compat with the Vercel deploy. Self-host sets `STORAGE_DRIVER=local`.
 */
export function getStorageDriver(): 'supabase' | 'local' {
  const raw = process.env.STORAGE_DRIVER?.toLowerCase()
  if (raw === 'local') return 'local'
  return 'supabase'
}

/**
 * Resolve the local root directory + URL prefix from env. Returns
 * sane defaults so a misconfigured server doesn't crash on startup,
 * but logs a warning if the env vars are missing.
 */
function getLocalConfig(): { root: string; baseUrl: string } {
  const root = process.env.LOCAL_STORAGE_DIR || '/var/labelhub/storage'
  const baseUrl = (
    process.env.LOCAL_STORAGE_BASE_URL || '/storage'
  ).replace(/\/+$/, '')
  return { root, baseUrl }
}

/**
 * Write bytes to the local FS at `${root}/${bucket}/${key}` and
 * return the public URL. Idempotent — overwrites the same path.
 *
 * Throws on filesystem errors. Caller (proxy/storage.ts or
 * export/storage.ts) catches + marks the upstream record failed.
 */
export async function uploadToLocalFs(
  input: LocalUploadInput,
): Promise<LocalUploadResult> {
  const { root, baseUrl } = getLocalConfig()
  // Defense in depth: prevent `..` traversal in `key`. Supabase
  // semantics use forward-slashes inside the bucket; we
  // normalize + reject anything weird.
  const safeKey = input.key.replace(/\\/g, '/').replace(/^\/+/, '')
  if (safeKey.includes('..')) {
    throw new Error(`unsafe storage key: ${input.key}`)
  }
  const safeBucket = input.bucket.replace(/[^a-zA-Z0-9_-]/g, '_')
  const fullDir = path.join(root, safeBucket, path.dirname(safeKey))
  const fullPath = path.join(root, safeBucket, safeKey)
  await fs.mkdir(fullDir, { recursive: true })
  await fs.writeFile(
    fullPath,
    input.bytes instanceof Buffer
      ? input.bytes
      : Buffer.from(input.bytes),
  )
  return {
    publicUrl: `${baseUrl}/${safeBucket}/${safeKey}`,
    path: safeKey,
  }
}

/**
 * Read a file from local storage. Used by the signed-URL fallback
 * path in `/api/export/jobs/[id]` — when local driver is on, we
 * generate a Next route signed URL with a short TTL instead of
 * Supabase's createSignedUrl.
 *
 * Returns null when the path doesn't exist.
 */
export async function readFromLocalFs(opts: {
  bucket: string
  key: string
}): Promise<{ bytes: Buffer; absolutePath: string } | null> {
  const { root } = getLocalConfig()
  const safeKey = opts.key.replace(/\\/g, '/').replace(/^\/+/, '')
  if (safeKey.includes('..')) return null
  const safeBucket = opts.bucket.replace(/[^a-zA-Z0-9_-]/g, '_')
  const fullPath = path.join(root, safeBucket, safeKey)
  try {
    const bytes = await fs.readFile(fullPath)
    return { bytes, absolutePath: fullPath }
  } catch {
    return null
  }
}
