import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { authenticateApiKey } from '@/lib/auth/api-key'
import { AppError } from '@/lib/errors'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import { getDb } from '@/lib/db/client'
import { workspaceWebhooks } from '@/lib/db/schema'
import { generateWebhookSecret } from '@/lib/webhooks/fanout'

/**
 * Webhooks endpoint — list + create subscriptions for the API key's workspace.
 *
 * GET  → list this workspace's webhooks (no secrets returned after creation)
 * POST → register a new webhook URL + optional event filter
 *
 * Delivery details:
 *   - body POSTed with X-LabelHub-Signature = HMAC-SHA256(secret, body)
 *   - X-LabelHub-Event header carries the event type
 *   - 5s timeout per delivery; no retries
 *   - 10 consecutive failures auto-disables the hook
 *
 * Known event types (for the `events` filter array):
 *   annotation.approved · annotation.rejected · annotation.revised ·
 *   annotation.submitted
 */

const KNOWN_EVENT_TYPES = [
  'annotation.approved',
  'annotation.rejected',
  'annotation.revised',
  'annotation.submitted',
] as const

const createSchema = z.object({
  url: z.string().url().max(2000),
  /** Empty / omitted = subscribe to all known annotation events. */
  events: z.array(z.enum(KNOWN_EVENT_TYPES)).optional(),
})

export async function GET(request: NextRequest) {
  return audit(request, 'GET /api/webhooks', async (auth) => {
    const db = getDb()
    const rows = await db
      .select({
        id: workspaceWebhooks.id,
        url: workspaceWebhooks.url,
        eventTypes: workspaceWebhooks.eventTypes,
        enabled: workspaceWebhooks.enabled,
        createdAt: workspaceWebhooks.createdAt,
        lastDeliveryAt: workspaceWebhooks.lastDeliveryAt,
        lastDeliveryStatus: workspaceWebhooks.lastDeliveryStatus,
        failureCount: workspaceWebhooks.failureCount,
      })
      .from(workspaceWebhooks)
      .where(
        and(
          eq(workspaceWebhooks.workspaceId, auth.workspaceId),
          isNull(workspaceWebhooks.revokedAt),
        ),
      )
      .orderBy(desc(workspaceWebhooks.createdAt))
    return {
      body: { webhooks: rows },
      status: 200,
    }
  })
}

export async function POST(request: NextRequest) {
  return audit(request, 'POST /api/webhooks', async (auth) => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new AppError('BAD_JSON', 'Body is not valid JSON.', 400)
    }
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION',
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
        400,
      )
    }

    const secret = generateWebhookSecret()
    const db = getDb()
    const [row] = await db
      .insert(workspaceWebhooks)
      .values({
        workspaceId: auth.workspaceId,
        url: parsed.data.url,
        secret,
        eventTypes: parsed.data.events ?? [],
        // createdBy is required NOT NULL — for API key actors we currently
        // don't track an originating user. We borrow the workspace creator
        // as the actor: every workspace has an adminId, and API key minting
        // requires admin auth. Cheap consistent backfill.
        createdBy: await resolveActorUserId(auth.workspaceId),
      })
      .returning()
    return {
      body: {
        webhook: {
          id: row.id,
          url: row.url,
          eventTypes: row.eventTypes,
          enabled: row.enabled,
          createdAt: row.createdAt.toISOString(),
          /**
           * Plain secret shown ONCE. Receiver should store this server-side
           * and use it to verify the HMAC signature on incoming deliveries.
           * Lost = revoke + re-register.
           */
          secret: row.secret,
        },
      },
      status: 201,
    }
  })
}

// ─── Audit + handler wrapper ─────────────────────────────────────────────

async function audit(
  request: NextRequest,
  endpoint: string,
  handler: (auth: {
    workspaceId: string
    apiKeyId: string
  }) => Promise<{ body: unknown; status: number }>,
): Promise<NextResponse> {
  const start = Date.now()
  const { userAgent, remoteAddr } = extractRequestMeta(request)
  let workspaceId: string | null = null
  let apiKeyId: string | null = null
  let status = 200
  let errorCode: string | null = null
  let response: NextResponse | undefined
  let responseBytes = 0

  try {
    const auth = await authenticateApiKey(request)
    if ('error' in auth) throw new AppError(auth.code, auth.error, 401)
    workspaceId = auth.workspaceId
    apiKeyId = auth.apiKeyId

    const result = await handler({
      workspaceId: auth.workspaceId,
      apiKeyId: auth.apiKeyId,
    })
    const body = JSON.stringify(result.body)
    responseBytes = body.length
    status = result.status
    response = new NextResponse(body, {
      status: result.status,
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
    endpoint,
    method: request.method,
    status,
    errorCode,
    durationMs: Date.now() - start,
    remoteAddr,
    userAgent,
    responseBytes,
  })

  return response!
}

async function resolveActorUserId(workspaceId: string): Promise<string> {
  const db = getDb()
  const { workspaces } = await import('@/lib/db/schema')
  const [ws] = await db
    .select({ adminId: workspaces.adminId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)
  if (!ws) {
    throw new AppError('NO_WORKSPACE', 'Workspace not found.', 404)
  }
  return ws.adminId
}
