import 'server-only'
import { createHash } from 'node:crypto'
import { getDb } from '@/lib/db/client'
import { apiRequestLog } from '@/lib/db/schema'

/**
 * API request audit logger.
 *
 * Call at the END of every Route Handler (always — success AND failure).
 * Fire-and-forget: never await; never block the response.
 *
 * Privacy: IPs are stored as SHA-256-prefix hashes (no raw retention).
 * Logging failures are swallowed — never crash a successful response.
 */

export interface AuditEntry {
  workspaceId: string | null
  apiKeyId?: string | null
  userId?: string | null
  endpoint: string
  method: string
  status: number
  durationMs?: number
  remoteAddr?: string | null
  userAgent?: string | null
  payloadBytes?: number
  responseBytes?: number
  errorCode?: string | null
}

function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  return createHash('sha256').update(ip).digest('hex').slice(0, 16)
}

/**
 * Best-effort log of one API call. Errors are caught + swallowed.
 * Returns void; caller should NOT await unless they want to block on the log write.
 */
export function logApiRequest(entry: AuditEntry): void {
  const db = getDb()
  db.insert(apiRequestLog)
    .values({
      workspaceId: entry.workspaceId,
      apiKeyId: entry.apiKeyId ?? null,
      userId: entry.userId ?? null,
      endpoint: entry.endpoint,
      method: entry.method,
      status: entry.status,
      durationMs: entry.durationMs ?? null,
      ipHash: hashIp(entry.remoteAddr),
      userAgent: entry.userAgent?.slice(0, 500) ?? null,
      payloadBytes: entry.payloadBytes ?? null,
      responseBytes: entry.responseBytes ?? null,
      errorCode: entry.errorCode ?? null,
    })
    .catch((err) => {
      // Don't crash the response over a log write failure.
      // eslint-disable-next-line no-console
      console.warn('audit log failed:', err instanceof Error ? err.message : err)
    })
}

/**
 * Helper for Route Handlers: extract user agent + remote addr from NextRequest.
 * Next.js doesn't expose request.ip directly anymore; sniff common headers.
 */
export function extractRequestMeta(request: Request): {
  userAgent: string | null
  remoteAddr: string | null
} {
  const headers = request.headers
  const remoteAddr =
    headers.get('cf-connecting-ip') ??
    headers.get('x-real-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  const userAgent = headers.get('user-agent')
  return { userAgent, remoteAddr }
}
