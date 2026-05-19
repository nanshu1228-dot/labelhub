import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { authenticateApiKey } from '@/lib/auth/api-key'
import { AppError } from '@/lib/errors'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import { getDb } from '@/lib/db/client'
import { workspaceWebhooks } from '@/lib/db/schema'

/**
 * DELETE /api/webhooks/[id]
 *
 * Revoke (soft-delete) a webhook subscription. The row stays for audit;
 * future deliveries are skipped because the fanout helper filters on
 * `revokedAt IS NULL`.
 */
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const start = Date.now()
  const { userAgent, remoteAddr } = extractRequestMeta(request)
  let workspaceId: string | null = null
  let apiKeyId: string | null = null
  let status = 200
  let errorCode: string | null = null
  let response: NextResponse | undefined
  let responseBytes = 0

  const { id } = await ctx.params

  try {
    const auth = await authenticateApiKey(request)
    if ('error' in auth) throw new AppError(auth.code, auth.error, 401)
    workspaceId = auth.workspaceId
    apiKeyId = auth.apiKeyId

    if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(id)) {
      throw new AppError('BAD_ID', 'Webhook id is not a UUID.', 400)
    }

    const db = getDb()
    const result = await db
      .update(workspaceWebhooks)
      .set({ revokedAt: new Date(), enabled: false })
      .where(
        and(
          eq(workspaceWebhooks.id, id),
          eq(workspaceWebhooks.workspaceId, workspaceId),
          isNull(workspaceWebhooks.revokedAt),
        ),
      )
      .returning({ id: workspaceWebhooks.id })

    if (result.length === 0) {
      throw new AppError('NOT_FOUND', 'Webhook not found or already revoked.', 404)
    }

    const body = JSON.stringify({ ok: true, id: result[0].id })
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
      // 3rd security audit: never echo DB/internal error text to clients.
      // Log server-side, surface a generic string in the response.
      console.error('[api] internal error:', msg, e instanceof Error ? e.stack : undefined)
      const safeMsg = 'Internal error'
      response = NextResponse.json(
        { error: { message: safeMsg, code: 'INTERNAL' } },
        { status: 500 },
      )
    }
  }

  logApiRequest({
    workspaceId,
    apiKeyId,
    endpoint: 'DELETE /api/webhooks/[id]',
    method: 'DELETE',
    status,
    errorCode,
    durationMs: Date.now() - start,
    remoteAddr,
    userAgent,
    responseBytes,
  })

  return response!
}
