import { NextResponse, after, type NextRequest } from 'next/server'
import { authenticateApiKey } from '@/lib/auth/api-key'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import { AppError } from '@/lib/errors'
import {
  openAIChatToTrajectory,
  type OpenAIChatRequest,
  type OpenAIChatResponse,
} from '@/lib/proxy/openai-compat-adapter'
import { OpenAIStreamAccumulator } from '@/lib/proxy/openai-stream-adapter'
import { teeWithAccumulator } from '@/lib/proxy/sse-tee'
import { persistWithStorage } from '@/lib/proxy/persist-with-storage'
import { resolveConnection, touchConnection } from '@/lib/proxy/connections'
import { buildUpstreamHeaders, getProviderDef } from '@/lib/proxy/provider-registry'
import { recordCallAndCheckRpm } from '@/lib/proxy/rate-limit'

/**
 * POST /api/proxy/doubao/chat/completions
 *
 * Transparent OpenAI-compatible proxy for ByteDance Doubao (ARK).
 *
 * The point: a publisher sets their `OPENAI_BASE_URL` to point here, swaps
 * their model key for a LabelHub workspace key, and gets back the EXACT
 * Doubao response — while LabelHub silently captures every call as a
 * canonical trajectory ready for annotation.
 *
 * Capture is on the response path, post-forward, post-success. If capture
 * fails we still return the upstream response to the client (we never fail
 * the user's call over an audit issue — that's the Pillar-2 audit principle:
 * logging never blocks the live path).
 *
 * Auth: workspace API key via Bearer. Distinct from the ANTHROPIC_API_KEY or
 * DOUBAO_API_KEY env-side secrets the proxy uses upstream.
 *
 * Streaming: supported via `sse-tee.ts`. When `stream: true` we forward the
 * raw SSE bytes to the client in real time AND feed parsed events into the
 * `OpenAIStreamAccumulator`. After the upstream closes, the assembled
 * response is converted to canonical and persisted — same code path as the
 * non-streaming branch.
 */

const DOUBAO_DEFAULT_BASE = 'https://ark.cn-beijing.volces.com/api/v3'

/**
 * Vercel serverless function lifetime cap.
 *
 * Doubao reasoning models (seed-2-0-lite, seed-r1) take 30-60s to complete a
 * single call. Vercel Hobby tops out at 60s; Pro allows up to 300s. We pick
 * 60 so a deploy works on either tier — bump to 300 on Pro if you observe
 * non-streaming timeouts on long reasoning prompts.
 *
 * Streaming responses do NOT prolong this budget per-frame — the cap is on
 * the total invocation duration, including the slow first-token wait.
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
    // ── Auth FIRST so unauth'd calls don't even reach Doubao ─────────────
    const auth = await authenticateApiKey(request)
    if ('error' in auth) {
      throw new AppError(auth.code, auth.error, 401)
    }
    workspaceId = auth.workspaceId
    apiKeyId = auth.apiKeyId

    // ── Read + validate body ─────────────────────────────────────────────
    const bodyText = await request.text()
    payloadBytes = bodyText.length

    let body: OpenAIChatRequest
    try {
      body = JSON.parse(bodyText) as OpenAIChatRequest
    } catch {
      throw new AppError('BAD_JSON', 'Body is not valid JSON.', 400)
    }

    if (!body || typeof body !== 'object') {
      throw new AppError('BAD_REQUEST', 'Body must be a JSON object.', 400)
    }
    if (typeof body.model !== 'string' || body.model.length === 0) {
      throw new AppError(
        'BAD_REQUEST',
        '`model` is required (e.g. "doubao-1-5-pro-32k-250115").',
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

    // ── Resolve upstream connection (DB first, env fallback) ─────────────
    const providerDef = getProviderDef('doubao')!
    const conn = await resolveConnection({
      workspaceId: auth.workspaceId,
      providerKind: 'doubao',
    })
    if (!conn) {
      throw new AppError(
        'UPSTREAM_NOT_CONFIGURED',
        'No Doubao provider configured. Add a connection at /workspaces/<id>/connections or set DOUBAO_API_KEY env.',
        502,
      )
    }

    // ── Per-workspace rate limit (RPM) ───────────────────────────────────
    // Tracks every call so we can later patch in tokens_used for TPM.
    let rateLogId: string | null = null
    if (conn.connectionId && conn.rateLimitRpm) {
      const allow = await recordCallAndCheckRpm({
        connectionId: conn.connectionId,
        limit: conn.rateLimitRpm,
      })
      rateLogId = allow.logId
      if (!allow.ok) {
        throw new AppError(
          'RATE_LIMITED',
          `Workspace exceeded ${conn.rateLimitRpm} req/min for this Doubao connection. Retry after ${allow.retryAfterSeconds}s.`,
          429,
        )
      }
    }
    // Fire-and-forget: mark this connection as most-recently-used so rotation
    // semantics work (newly-created connections win their first hit).
    if (conn.connectionId) {
      void touchConnection(conn.connectionId).catch(() => {})
    }
    // Keep these in scope for after() to patch token usage when available.
    const _capturedRateLogId = rateLogId
    void _capturedRateLogId

    let upstreamRes: Response
    try {
      upstreamRes = await fetch(`${conn.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildUpstreamHeaders(providerDef, conn.apiKey, request.headers),
        body: bodyText, // forward verbatim
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new AppError(
        'UPSTREAM_FETCH_FAILED',
        `Failed to reach Doubao: ${msg}`,
        502,
      )
    }

    // ── Non-2xx upstream: same passthrough regardless of stream mode ─────
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
      // Tee the upstream SSE: bytes go to the client immediately; events
      // also feed an accumulator. The persist call is scheduled via
      // `after()` so it runs AFTER the response is sent, outside the
      // function's maxDuration budget — this is what guarantees we can't
      // lose a capture to a tight timeout right as the stream completes.
      const acc = new OpenAIStreamAccumulator()
      let captured: OpenAIChatResponse | null = null

      const teedBody = teeWithAccumulator({
        upstream: upstreamRes,
        onEvent: (ev) => {
          acc.feed(ev.data)
        },
        onDone: async () => {
          if (acc.sawAnyChunk) captured = acc.toFinalResponse()
        },
      })

      const streamWorkspaceId = auth.workspaceId
      after(async () => {
        if (!captured) return
        try {
          const trajectory = openAIChatToTrajectory(body, captured, {
            agentName: `doubao/${body.model}`,
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
            'doubao proxy stream: capture failed (passthrough still succeeded):',
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

      let upstream: OpenAIChatResponse
      try {
        upstream = JSON.parse(upstreamText) as OpenAIChatResponse
      } catch {
        status = 200
        response = new NextResponse(upstreamText, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
        return finishResponse()
      }

      // Persist via `after()` — same reason as the streaming branch: the
      // ~200ms DB write + attachment uploads should not eat into our 60s
      // function budget when the upstream call already consumed most of it.
      const captured = upstream
      const nonStreamWorkspaceId = auth.workspaceId
      after(async () => {
        try {
          const trajectory = openAIChatToTrajectory(body, captured, {
            agentName: `doubao/${body.model}`,
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
            'doubao proxy: capture failed (passthrough still succeeded):',
            e instanceof Error ? e.message : e,
          )
        }
      })

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

  return finishResponse()

  function finishResponse() {
    logApiRequest({
      workspaceId,
      apiKeyId,
      endpoint: 'POST /api/proxy/doubao/chat/completions',
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
}

// Reject unsupported methods explicitly so clients get a clear 405 rather than
// the default Next.js 404 on a folder without GET.
export async function GET() {
  return NextResponse.json(
    {
      error: {
        message:
          'Use POST. This endpoint is an OpenAI-compatible chat completions proxy.',
        code: 'METHOD_NOT_ALLOWED',
        type: 'labelhub_proxy',
      },
    },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
