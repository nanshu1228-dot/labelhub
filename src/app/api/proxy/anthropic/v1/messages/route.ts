import { NextResponse, after, type NextRequest } from 'next/server'
import { authenticateApiKey } from '@/lib/auth/api-key'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import { AppError } from '@/lib/errors'
import {
  anthropicMessagesToTrajectory,
  type AnthropicMessagesRequest,
  type AnthropicMessagesResponse,
} from '@/lib/proxy/anthropic-messages-adapter'
import { AnthropicStreamAccumulator } from '@/lib/proxy/anthropic-stream-adapter'
import { teeWithAccumulator } from '@/lib/proxy/sse-tee'
import { persistWithStorage } from '@/lib/proxy/persist-with-storage'
import { resolveConnection, touchConnection } from '@/lib/proxy/connections'
import { buildUpstreamHeaders, getProviderDef } from '@/lib/proxy/provider-registry'
import { recordCallAndCheckRpm } from '@/lib/proxy/rate-limit'

/**
 * POST /api/proxy/anthropic/v1/messages
 *
 * Drop-in proxy for the Anthropic Messages API. Aimed at **Claude Code**
 * and any Anthropic SDK user: set two env vars and every `messages.create()`
 * call gets captured by LabelHub before forwarding upstream.
 *
 *   export ANTHROPIC_BASE_URL=http://localhost:3000/api/proxy/anthropic
 *   export ANTHROPIC_API_KEY=lh_ws_…   # workspace key, not your real Anthropic key
 *
 * The proxy uses the server-side `ANTHROPIC_API_KEY` in `.env.local` to talk
 * to api.anthropic.com — the user-facing harness only ever sees the LabelHub
 * workspace key. Same security model as our Doubao proxy.
 *
 * Auth: `Authorization: Bearer lh_ws_...` or `x-api-key: lh_ws_...` (Anthropic
 * SDK sends keys via x-api-key, so accepting that header is what makes this
 * a zero-config drop-in for stock harnesses).
 *
 * Streaming: supported via `sse-tee.ts`. When `stream: true`, raw SSE bytes
 * pass through to the client in real time while events feed an accumulator;
 * after upstream closes, the assembled message is persisted as canonical.
 */

const ANTHROPIC_DEFAULT_BASE = 'https://api.anthropic.com'

/**
 * Vercel function timeout. Sonnet / Opus with extended thinking + tool use
 * can run 60-120s on hard tasks. We set 60 to work on the Hobby tier; raise
 * to 300 on Pro if you serve long-thinking models.
 */
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const start = Date.now()
  const { userAgent, remoteAddr } = extractRequestMeta(request)

  let workspaceId: string | null = null
  let apiKeyId: string | null = null
  let status = 200
  let errorCode: string | null = null
  let response: NextResponse | undefined
  let payloadBytes = 0
  let responseBytes = 0

  try {
    // ── Auth first ───────────────────────────────────────────────────────
    const auth = await authenticateApiKey(request)
    if ('error' in auth) {
      throw new AppError(auth.code, auth.error, 401)
    }
    workspaceId = auth.workspaceId
    apiKeyId = auth.apiKeyId

    // ── Read + validate body ─────────────────────────────────────────────
    const bodyText = await request.text()
    payloadBytes = bodyText.length

    let body: AnthropicMessagesRequest
    try {
      body = JSON.parse(bodyText) as AnthropicMessagesRequest
    } catch {
      throw new AppError('BAD_JSON', 'Body is not valid JSON.', 400)
    }

    if (!body || typeof body !== 'object') {
      throw new AppError('BAD_REQUEST', 'Body must be a JSON object.', 400)
    }
    if (typeof body.model !== 'string' || body.model.length === 0) {
      throw new AppError(
        'BAD_REQUEST',
        '`model` is required (e.g. "claude-sonnet-4-6").',
        400,
      )
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw new AppError(
        'BAD_REQUEST',
        '`messages` is required and must be a non-empty array.',
        400,
      )
    }
    const isStream = body.stream === true

    // ── Resolve connection + rate-limit (same model as Doubao proxy) ─────
    const providerDef = getProviderDef('anthropic')!
    const conn = await resolveConnection({
      workspaceId: auth.workspaceId,
      providerKind: 'anthropic',
    })
    if (!conn) {
      throw new AppError(
        'UPSTREAM_NOT_CONFIGURED',
        'No Anthropic provider configured. Add a connection at /workspaces/<id>/connections or set ANTHROPIC_API_KEY env.',
        502,
      )
    }
    if (conn.connectionId && conn.rateLimitRpm) {
      const allow = await recordCallAndCheckRpm({
        connectionId: conn.connectionId,
        limit: conn.rateLimitRpm,
      })
      if (!allow.ok) {
        throw new AppError(
          'RATE_LIMITED',
          `Workspace exceeded ${conn.rateLimitRpm} req/min for this Anthropic connection. Retry after ${allow.retryAfterSeconds}s.`,
          429,
        )
      }
    }
    if (conn.connectionId) {
      void touchConnection(conn.connectionId).catch(() => {})
    }

    let upstreamRes: Response
    try {
      upstreamRes = await fetch(`${conn.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: buildUpstreamHeaders(providerDef, conn.apiKey, request.headers),
        body: bodyText,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new AppError(
        'UPSTREAM_FETCH_FAILED',
        `Failed to reach Anthropic: ${msg}`,
        502,
      )
    }

    if (!upstreamRes.ok) {
      const upstreamText = await upstreamRes.text()
      responseBytes = upstreamText.length
      status = upstreamRes.status
      errorCode = `UPSTREAM_${upstreamRes.status}`
      response = new NextResponse(upstreamText, {
        status: upstreamRes.status,
        headers: { 'content-type': 'application/json' },
      })
    } else if (isStream) {
      // ── Streaming branch ───────────────────────────────────────────────
      // Persist runs in `after()` so the DB write is decoupled from the
      // function's maxDuration — see Doubao route for the rationale.
      const acc = new AnthropicStreamAccumulator()
      let captured: AnthropicMessagesResponse | null = null

      const teedBody = teeWithAccumulator({
        upstream: upstreamRes,
        onEvent: (ev) => {
          acc.feed(ev.event, ev.data)
        },
        onDone: async () => {
          if (acc.sawAnyChunk) captured = acc.toFinalResponse()
        },
      })

      const streamWorkspaceId = auth.workspaceId
      after(async () => {
        if (!captured) return
        try {
          const trajectory = anthropicMessagesToTrajectory(body, captured, {
            agentName: `anthropic/${body.model}`,
            source: 'production',
            latencyMs: Date.now() - start,
          })
          await persistWithStorage({
            workspaceId: streamWorkspaceId,
            trajectory,
          })
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(
            'anthropic proxy stream: capture failed (passthrough still succeeded):',
            e instanceof Error ? e.message : e,
          )
        }
      })

      status = 200
      response = new NextResponse(teedBody, {
        status: 200,
        headers: {
          'content-type':
            upstreamRes.headers.get('content-type') ?? 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        },
      })
    } else {
      // ── Non-streaming branch ───────────────────────────────────────────
      const upstreamText = await upstreamRes.text()
      responseBytes = upstreamText.length

      let upstream: AnthropicMessagesResponse | null = null
      try {
        upstream = JSON.parse(upstreamText) as AnthropicMessagesResponse
      } catch {
        // Non-JSON 200 is unusual; forward without capture.
      }

      if (upstream) {
        const captured = upstream
        const nonStreamWorkspaceId = auth.workspaceId
        after(async () => {
          try {
            const trajectory = anthropicMessagesToTrajectory(body, captured, {
              agentName: `anthropic/${body.model}`,
              source: 'production',
              latencyMs: Date.now() - start,
            })
            await persistWithStorage({
              workspaceId: nonStreamWorkspaceId,
              trajectory,
            })
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(
              'anthropic proxy: capture failed (passthrough still succeeded):',
              e instanceof Error ? e.message : e,
            )
          }
        })
      }

      status = 200
      response = new NextResponse(upstreamText, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
  } catch (e: unknown) {
    if (e instanceof AppError) {
      status = e.status
      errorCode = e.code
      response = NextResponse.json(
        { error: { message: e.message, code: e.code, type: 'labelhub_proxy' } },
        { status: e.status },
      )
    } else {
      status = 500
      errorCode = 'INTERNAL'
      const msg = e instanceof Error ? e.message : 'Unknown error'
      response = NextResponse.json(
        { error: { message: msg, code: 'INTERNAL', type: 'labelhub_proxy' } },
        { status: 500 },
      )
    }
  }

  logApiRequest({
    workspaceId,
    apiKeyId,
    endpoint: 'POST /api/proxy/anthropic/v1/messages',
    method: 'POST',
    status,
    errorCode,
    durationMs: Date.now() - start,
    remoteAddr,
    userAgent,
    payloadBytes,
    responseBytes,
  })

  return response!
}

export async function GET() {
  return NextResponse.json(
    {
      error: {
        message:
          'Use POST. This endpoint is an Anthropic Messages API proxy.',
        code: 'METHOD_NOT_ALLOWED',
        type: 'labelhub_proxy',
      },
    },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
