import { NextResponse, after, type NextRequest } from 'next/server'
import { authenticateApiKey } from '@/lib/auth/api-key'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import { AppError } from '@/lib/errors'
import {
  openAIChatToTrajectory,
  type OpenAIChatRequest,
  type OpenAIChatResponse,
} from '@/lib/proxy/openai-compat-adapter'
import {
  anthropicMessagesToTrajectory,
  type AnthropicMessagesRequest,
  type AnthropicMessagesResponse,
} from '@/lib/proxy/anthropic-messages-adapter'
import { OpenAIStreamAccumulator } from '@/lib/proxy/openai-stream-adapter'
import { AnthropicStreamAccumulator } from '@/lib/proxy/anthropic-stream-adapter'
import { teeWithAccumulator } from '@/lib/proxy/sse-tee'
import { persistWithStorage } from '@/lib/proxy/persist-with-storage'
import {
  resolveConnection,
  touchConnection,
} from '@/lib/proxy/connections'
import {
  buildUpstreamHeaders,
  getProviderDef,
  type ProviderDef,
} from '@/lib/proxy/provider-registry'
import { recordCallAndCheckRpm, getApiKeyRpm } from '@/lib/proxy/rate-limit'
import { injectScopeForFamily } from '@/lib/proxy/inject-scope'
import { resolveTopicScope } from '@/lib/queries/topic-scope'

/**
 * Default per-connection rate limit when none is configured. Set to 60
 * req/min (1 req/sec sustained) — high enough that legitimate clients
 * never trip it but low enough that a leaked / forgotten key on an
 * unconfigured connection can't burn through token budget in seconds.
 * Admins who need higher throughput set `rateLimitRpm` on the
 * connection row explicitly.
 */
const DEFAULT_PROXY_RPM_FLOOR = 60

/**
 * Catch-all proxy route — `POST /api/proxy/<kind>/<...path>`
 *
 * Replaces the per-provider route files. Every registered provider in
 * `provider-registry.ts` gets a working endpoint automatically:
 *
 *   /api/proxy/doubao/chat/completions       (openai-compat)
 *   /api/proxy/anthropic/v1/messages         (anthropic)
 *   /api/proxy/deepseek/chat/completions     (openai-compat)
 *   /api/proxy/qwen/chat/completions         (openai-compat)
 *   /api/proxy/moonshot/chat/completions     (openai-compat)
 *   /api/proxy/openai/chat/completions       (openai-compat)
 *
 * The `path` segment is forwarded verbatim to `<connection.baseUrl>/<path>`,
 * so a Doubao client hitting `/api/proxy/doubao/embeddings` would just work
 * if Doubao supports it upstream (we don't capture non-chat calls — only the
 * chat-completions / messages families have adapters; everything else falls
 * through to "forward + don't try to interpret").
 *
 * Adding a new provider:
 *   1. Add an entry to PROVIDERS in provider-registry.ts (3 lines)
 *   2. Done. The catch-all picks it up; the UI auto-lists it.
 *
 * Streaming, after()-window persist, Vault-backed keys, RPM rate limiting —
 * all of it works identically across providers because they share this code.
 */

// Vercel function timeout — 60s works on Hobby; Pro can bump to 300.
// Reasoning models may take 30-45s, so 60 is the safe floor.
export const maxDuration = 60

interface ProxyContext {
  request: NextRequest
  providerDef: ProviderDef
  workspaceId: string
  apiKeyId: string
  upstreamUrl: string
  upstreamHeaders: Record<string, string>
  bodyText: string
  bodyJson: Record<string, unknown>
  isStream: boolean
  startMs: number
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ kind: string; path: string[] }> },
) {
  const startMs = Date.now()
  const { userAgent, remoteAddr } = extractRequestMeta(request)
  let workspaceId: string | null = null
  let apiKeyId: string | null = null
  let status = 200
  let errorCode: string | null = null
  let response: NextResponse | undefined
  let payloadBytes = 0
  let responseBytes = 0
  let endpointLabel = 'POST /api/proxy/unknown'

  try {
    // ── 1. Resolve provider from URL ──────────────────────────────────
    const { kind, path } = await ctx.params
    const providerDef = getProviderDef(kind)
    if (!providerDef) {
      throw new AppError(
        'UNKNOWN_PROVIDER',
        `Provider "${kind}" is not registered. See provider-registry.ts.`,
        404,
      )
    }
    endpointLabel = `POST /api/proxy/${kind}/${path.join('/')}`

    // ── 2. Auth ──────────────────────────────────────────────────────
    const auth = await authenticateApiKey(request)
    if ('error' in auth) {
      throw new AppError(auth.code, auth.error, 401)
    }
    workspaceId = auth.workspaceId
    apiKeyId = auth.apiKeyId

    // ── 3. Read + validate body ──────────────────────────────────────
    const bodyText = await request.text()
    payloadBytes = bodyText.length
    let bodyJson: Record<string, unknown>
    try {
      bodyJson = JSON.parse(bodyText) as Record<string, unknown>
    } catch {
      throw new AppError('BAD_JSON', 'Body is not valid JSON.', 400)
    }
    if (!bodyJson || typeof bodyJson !== 'object') {
      throw new AppError('BAD_REQUEST', 'Body must be a JSON object.', 400)
    }
    if (typeof bodyJson.model !== 'string' || bodyJson.model.length === 0) {
      throw new AppError('BAD_REQUEST', '`model` is required.', 400)
    }
    if (!Array.isArray(bodyJson.messages) || bodyJson.messages.length === 0) {
      throw new AppError(
        'BAD_REQUEST',
        '`messages` is required and must be a non-empty array.',
        400,
      )
    }
    const isStream = bodyJson.stream === true

    // ── 4. Resolve connection (DB → env fallback) ────────────────────
    const conn = await resolveConnection({
      workspaceId: auth.workspaceId,
      providerKind: kind,
    })
    if (!conn) {
      throw new AppError(
        'UPSTREAM_NOT_CONFIGURED',
        `No ${providerDef.label} provider configured. Add a connection at /workspaces/<id>/connections or set ${providerDef.envFallback} env.`,
        502,
      )
    }

    // ── 5. Rate limit (per-connection + per-API-key) ─────────────────
    // The connection limit caps the workspace's total spend on this
    // provider; the per-key limit caps any individual API key (e.g. a
    // third-party integration we don't fully trust). Both checked off the
    // same logged row.
    //
    // Phase-6 security audit hardening: previously this block was guarded
    // by `conn.rateLimitRpm` truthy — if a connection was registered
    // without an explicit RPM (or RPM=0), the limit check was SKIPPED
    // ENTIRELY. A leaked API key against such a connection meant unlimited
    // upstream spend. Now we apply a default floor (DEFAULT_PROXY_RPM_FLOOR
    // = 60 req/min) so every connection has SOME cap, even if admin
    // didn't set one. Admins who genuinely need higher throughput set
    // rateLimitRpm explicitly; the default just rules out the runaway
    // case.
    if (conn.connectionId) {
      const effectiveLimit = conn.rateLimitRpm ?? DEFAULT_PROXY_RPM_FLOOR
      const apiKeyRpm = await getApiKeyRpm(auth.apiKeyId)
      const allow = await recordCallAndCheckRpm({
        connectionId: conn.connectionId,
        limit: effectiveLimit,
        apiKeyId: auth.apiKeyId,
        apiKeyLimit: apiKeyRpm,
      })
      if (!allow.ok) {
        const msg =
          allow.scope === 'api-key'
            ? `API key exceeded its own ${apiKeyRpm} req/min cap. Retry after ${allow.retryAfterSeconds}s.`
            : `Workspace exceeded ${effectiveLimit} req/min for this ${providerDef.label} connection. Retry after ${allow.retryAfterSeconds}s.`
        throw new AppError('RATE_LIMITED', msg, 429)
      }
    }
    if (conn.connectionId) {
      void touchConnection(conn.connectionId).catch(() => {})
    }

    // ── 5b. Topic-scope injection (Layer A guardrail) ────────────────
    // Auto-derived from the workspace's primary task by Haiku; cached in
    // task_topic_scopes. Prepended to the upstream system prompt as
    // non-negotiable platform policy so a leaked API key can't be
    // repurposed as a generic chatbot.
    //
    // Fail-open: if no scope is configured for this workspace, skip
    // injection silently. Admins generate one via the regenerate action.
    // We rebuild the outbound body when injection actually happens; this is
    // the bytes that hit the upstream provider. Trajectory capture deliberately
    // continues to record the ORIGINAL `bodyJson` (publisher intent) — the
    // policy block isn't part of the publisher's data and including it would
    // bloat every capture identically. The model's RESPONSE captured below
    // will already reflect the policy's effect.
    let outboundBodyText = bodyText
    try {
      const scope = await resolveTopicScope({
        workspaceId: auth.workspaceId,
      })
      if (scope) {
        const result = injectScopeForFamily(
          providerDef.family,
          bodyJson,
          scope.scope.suffix,
        )
        if (result.injected) {
          outboundBodyText = JSON.stringify(result.body)
        }
      }
    } catch (e) {
      // Don't let a topic-scope read failure block the request — the
      // proxy's job is to forward. Log and pass through with the raw body.
      // eslint-disable-next-line no-console
      console.warn(
        `${providerDef.kind} proxy: topic-scope read failed, passing through:`,
        e instanceof Error ? e.message : e,
      )
    }

    // ── 6. Forward to upstream ───────────────────────────────────────
    const upstreamUrl = `${conn.baseUrl}/${path.join('/')}`
    const upstreamHeaders = buildUpstreamHeaders(
      providerDef,
      conn.apiKey,
      request.headers,
    )
    let upstreamRes: Response
    try {
      upstreamRes = await fetch(upstreamUrl, {
        method: 'POST',
        headers: upstreamHeaders,
        body: outboundBodyText,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new AppError(
        'UPSTREAM_FETCH_FAILED',
        `Failed to reach ${providerDef.label}: ${msg}`,
        502,
      )
    }

    const proxyCtx: ProxyContext = {
      request,
      providerDef,
      workspaceId: auth.workspaceId,
      apiKeyId: auth.apiKeyId,
      upstreamUrl,
      upstreamHeaders,
      bodyText,
      bodyJson,
      isStream,
      startMs,
    }

    // ── 7. Non-2xx upstream: pass through, no capture ────────────────
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
      // ── 8a. Streaming branch (family-routed) ───────────────────────
      response = handleStream(upstreamRes, proxyCtx)
      status = 200
    } else {
      // ── 8b. Non-streaming branch ───────────────────────────────────
      const upstreamText = await upstreamRes.text()
      responseBytes = upstreamText.length
      response = await handleNonStream(upstreamText, proxyCtx)
      status = 200
    }
  } catch (e: unknown) {
    if (e instanceof AppError) {
      status = e.status
      errorCode = e.code
      response = NextResponse.json(
        {
          error: {
            message: e.message,
            code: e.code,
            type: 'labelhub_proxy',
          },
        },
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
        { error: { message: safeMsg, code: 'INTERNAL', type: 'labelhub_proxy' } },
        { status: 500 },
      )
    }
  }

  logApiRequest({
    workspaceId,
    apiKeyId,
    endpoint: endpointLabel,
    method: 'POST',
    status,
    errorCode,
    durationMs: Date.now() - startMs,
    remoteAddr,
    userAgent,
    payloadBytes,
    responseBytes,
  })

  return response!
}

// ────────────────────────────────────────────────────────────────────
// Streaming branch — family-routed accumulator + tee → after()-persist
// ────────────────────────────────────────────────────────────────────

function handleStream(upstreamRes: Response, ctx: ProxyContext): NextResponse {
  if (ctx.providerDef.family === 'anthropic') {
    const acc = new AnthropicStreamAccumulator()
    let captured: AnthropicMessagesResponse | null = null
    const teedBody = teeWithAccumulator({
      upstream: upstreamRes,
      onEvent: (ev) => acc.feed(ev.event, ev.data),
      onDone: async () => {
        if (acc.sawAnyChunk) captured = acc.toFinalResponse()
      },
    })
    scheduleCapture(ctx, () => captured, 'anthropic')
    return streamResponse(upstreamRes, teedBody)
  }

  // openai-compat default
  const acc = new OpenAIStreamAccumulator()
  let captured: OpenAIChatResponse | null = null
  const teedBody = teeWithAccumulator({
    upstream: upstreamRes,
    onEvent: (ev) => acc.feed(ev.data),
    onDone: async () => {
      if (acc.sawAnyChunk) captured = acc.toFinalResponse()
    },
  })
  scheduleCapture(ctx, () => captured, 'openai')
  return streamResponse(upstreamRes, teedBody)
}

function streamResponse(
  upstream: Response,
  teedBody: ReadableStream<Uint8Array>,
): NextResponse {
  return new NextResponse(teedBody, {
    status: 200,
    headers: {
      'content-type':
        upstream.headers.get('content-type') ?? 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
}

// ────────────────────────────────────────────────────────────────────
// Non-streaming branch
// ────────────────────────────────────────────────────────────────────

async function handleNonStream(
  upstreamText: string,
  ctx: ProxyContext,
): Promise<NextResponse> {
  if (ctx.providerDef.family === 'anthropic') {
    let upstream: AnthropicMessagesResponse | null = null
    try {
      upstream = JSON.parse(upstreamText) as AnthropicMessagesResponse
    } catch {
      /* non-JSON 200 from Anthropic — forward without capture */
    }
    if (upstream) {
      const captured = upstream
      after(async () => {
        try {
          const trajectory = anthropicMessagesToTrajectory(
            ctx.bodyJson as unknown as AnthropicMessagesRequest,
            captured,
            {
              agentName: `${ctx.providerDef.kind}/${String(ctx.bodyJson.model)}`,
              source: 'production',
              latencyMs: Date.now() - ctx.startMs,
            },
          )
          await persistWithStorage({
            workspaceId: ctx.workspaceId,
            trajectory,
          })
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(
            `${ctx.providerDef.kind} proxy: capture failed (passthrough still succeeded):`,
            e instanceof Error ? e.message : e,
          )
        }
      })
    }
    return new NextResponse(upstreamText, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  // openai-compat default
  let upstream: OpenAIChatResponse | null = null
  try {
    upstream = JSON.parse(upstreamText) as OpenAIChatResponse
  } catch {
    return new NextResponse(upstreamText, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const captured = upstream
  after(async () => {
    try {
      const trajectory = openAIChatToTrajectory(
        ctx.bodyJson as unknown as OpenAIChatRequest,
        captured,
        {
          agentName: `${ctx.providerDef.kind}/${String(ctx.bodyJson.model)}`,
          source: 'production',
          latencyMs: Date.now() - ctx.startMs,
        },
      )
      await persistWithStorage({
        workspaceId: ctx.workspaceId,
        trajectory,
      })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `${ctx.providerDef.kind} proxy: capture failed (passthrough still succeeded):`,
        e instanceof Error ? e.message : e,
      )
    }
  })
  return new NextResponse(upstreamText, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

// ────────────────────────────────────────────────────────────────────
// Shared: schedule the post-stream persist via after() so capture
// happens AFTER the response is sent — outside the function's maxDuration
// for the client-facing portion.
// ────────────────────────────────────────────────────────────────────

function scheduleCapture<T extends AnthropicMessagesResponse | OpenAIChatResponse>(
  ctx: ProxyContext,
  getCaptured: () => T | null,
  family: 'anthropic' | 'openai',
): void {
  after(async () => {
    const captured = getCaptured()
    if (!captured) return
    try {
      const agentName = `${ctx.providerDef.kind}/${String(ctx.bodyJson.model)}`
      const trajectory =
        family === 'anthropic'
          ? anthropicMessagesToTrajectory(
              ctx.bodyJson as unknown as AnthropicMessagesRequest,
              captured as AnthropicMessagesResponse,
              {
                agentName,
                source: 'production',
                latencyMs: Date.now() - ctx.startMs,
              },
            )
          : openAIChatToTrajectory(
              ctx.bodyJson as unknown as OpenAIChatRequest,
              captured as OpenAIChatResponse,
              {
                agentName,
                source: 'production',
                latencyMs: Date.now() - ctx.startMs,
              },
            )
      await persistWithStorage({
        workspaceId: ctx.workspaceId,
        trajectory,
      })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `${ctx.providerDef.kind} proxy stream: capture failed (passthrough still succeeded):`,
        e instanceof Error ? e.message : e,
      )
    }
  })
}

// ────────────────────────────────────────────────────────────────────
// Reject unsupported methods
// ────────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ kind: string; path: string[] }> },
) {
  const { kind, path } = await ctx.params
  return NextResponse.json(
    {
      error: {
        message: `Use POST. /api/proxy/${kind}/${path.join('/')} is a chat-completions/messages proxy.`,
        code: 'METHOD_NOT_ALLOWED',
        type: 'labelhub_proxy',
      },
    },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
