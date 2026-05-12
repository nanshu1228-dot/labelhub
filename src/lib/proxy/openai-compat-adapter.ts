/**
 * OpenAI-Chat-Completions → canonical trajectory adapter.
 *
 * Doubao (字节豆包 / ByteDance ARK), DeepSeek, Qwen, Moonshot, and most
 * Chinese model providers expose an OpenAI-compatible Chat Completions API
 * (POST /v1/chat/completions). We adapt that exchange into our canonical
 * trajectory schema so the proxy can transparently forward the call and
 * still capture the full conversation for annotation.
 *
 * Why a single adapter, not "doubao-adapter":
 *   The wire shape is identical across all OpenAI-compatible providers.
 *   Naming this "doubao" would invite duplication when we add DeepSeek
 *   tomorrow. The proxy route picks the agentName / base URL per provider;
 *   the adapter stays generic.
 *
 * Capture semantics (single-call slice — the proxy does NOT execute tools):
 *   - `messages[]` from the request becomes ordered prior steps:
 *       system   → meta.systemPrompt (NOT a step)
 *       user[0]  → rootPrompt        (NOT a step, but anchors the trajectory)
 *       user[≥1] → `thinking`        (synthesized — user follow-up turn)
 *       assistant.content      → `thinking` (a previous turn's answer in history)
 *       assistant.tool_calls[] → `tool_call` (one step per call)
 *       tool                   → `tool_result`
 *   - The response message becomes the trailing step(s):
 *       tool_calls present → `tool_call` for each (no `final_response`)
 *       else               → `final_response`
 *
 * The proxy is intentionally NOT a multi-turn driver. If the user's framework
 * loops (call → execute tool → call again), we capture each call as its own
 * trajectory. Stitching them into one is the SDK's job, not the proxy's.
 */

import type {
  CanonicalStep,
  CanonicalTrajectory,
  TrajectorySource,
} from '@/lib/trajectories/schema'
import { inspectTrajectoryEncoding } from './encoding-qc'
import {
  extractAttachments,
  type AttachmentRecord,
} from './attachment-extractor'
import {
  extractToolCatalog,
  type ToolCatalogEntry,
} from './tool-catalog'

// ── OpenAI-compatible request / response wire types ────────────────────
// (Trimmed to what we actually read — additional fields pass through.)

export interface OpenAIChatRequest {
  model: string
  messages: OpenAIMessage[]
  tools?: unknown
  /** 'auto' | 'none' | 'required' | { type: 'function', function: { name } } */
  tool_choice?: unknown
  /** { type: 'json_object' } | { type: 'json_schema', json_schema: {...} } */
  response_format?: unknown
  parallel_tool_calls?: boolean
  seed?: number
  top_p?: number
  presence_penalty?: number
  frequency_penalty?: number
  stop?: string | string[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  [k: string]: unknown
}

export type OpenAIMessage =
  | { role: 'system'; content: string | null }
  | { role: 'user'; content: string | null }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: OpenAIToolCall[]
    }
  | {
      role: 'tool'
      content: string | null
      tool_call_id: string
      name?: string
    }

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    /** Arguments are wire-encoded as a JSON STRING per OpenAI spec. */
    arguments: string
  }
}

export interface OpenAIChatResponse {
  id?: string
  model?: string
  created?: number
  choices: Array<{
    index?: number
    message: {
      role: 'assistant'
      content: string | null
      tool_calls?: OpenAIToolCall[]
      /**
       * Doubao / DeepSeek-R1 / Qwen-QwQ reasoning models surface chain-of-thought
       * here, separate from `content`. Standard OpenAI doesn't have this field,
       * but every Chinese reasoning provider in 2026 does — and it's gold for
       * agent-trace-eval (rate the reasoning, not just the conclusion).
       */
      reasoning_content?: string | null
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  [k: string]: unknown
}

// ── Adapter ────────────────────────────────────────────────────────────

export interface AdapterOpts {
  /** Logical agent name for this trajectory — usually the proxy provider, e.g. "doubao/<model>". */
  agentName: string
  /** Where this trajectory came from. Production proxy traffic ⇒ 'production'. */
  source: TrajectorySource
  /** Latency of the upstream call in ms (for timing analytics). */
  latencyMs?: number
}

/**
 * Best-effort JSON parse — leaves strings alone if they aren't valid JSON.
 * (Some agents pass non-JSON tool args in the wild; we keep them raw rather
 * than rejecting the whole trajectory.)
 */
function parseArgs(raw: string): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { _raw: raw }
  }
}

/**
 * Coerce assistant.content into a string. Some providers send arrays of
 * content blocks (OpenAI vision-style); we flatten by concatenating text.
 */
function stringifyContent(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === 'string') return p
        if (p && typeof p === 'object' && 'text' in p) {
          return String((p as { text: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  return JSON.stringify(content)
}

export function openAIChatToTrajectory(
  request: OpenAIChatRequest,
  response: OpenAIChatResponse,
  opts: AdapterOpts,
): CanonicalTrajectory {
  const steps: CanonicalStep[] = []
  let sequence = 0

  // ── Split out system + first user message ────────────────────────────
  const systemPrompts: string[] = []
  let rootPrompt: string | null = null
  const history = [...request.messages]

  // Find first user message → rootPrompt (the trajectory anchor).
  for (let i = 0; i < history.length; i++) {
    const m = history[i]
    if (m.role === 'system') {
      systemPrompts.push(stringifyContent(m.content))
    } else if (m.role === 'user' && rootPrompt == null) {
      rootPrompt = stringifyContent(m.content)
      history.splice(i, 1)
      break
    }
  }
  if (rootPrompt == null) {
    // Defensive: a chat with no user message at all. Use empty placeholder so
    // the schema validator doesn't reject — the captured trajectory will still
    // surface the system prompt + response.
    rootPrompt = '(no user message in request)'
  }

  // Filter out system messages from the history (we keep them in meta only).
  const remainingHistory = history.filter((m) => m.role !== 'system')

  // ── Convert prior history into steps ─────────────────────────────────
  for (const m of remainingHistory) {
    if (m.role === 'user') {
      const text = stringifyContent(m.content)
      if (text) {
        steps.push({
          sequence: sequence++,
          kind: 'thinking',
          content: { text: `[user follow-up] ${text}` },
        })
      }
    } else if (m.role === 'assistant') {
      // Prior assistant turn — its content was the answer at that turn,
      // and tool_calls (if any) were resolved by subsequent tool messages.
      const text = stringifyContent(m.content)
      if (text) {
        steps.push({
          sequence: sequence++,
          kind: 'thinking',
          content: { text: `[prior assistant] ${text}` },
        })
      }
      for (const tc of m.tool_calls ?? []) {
        steps.push({
          sequence: sequence++,
          kind: 'tool_call',
          content: {
            toolCallId: tc.id,
            toolName: tc.function.name,
            args: parseArgs(tc.function.arguments),
            providerKind: 'function',
          },
        })
      }
    } else if (m.role === 'tool') {
      steps.push({
        sequence: sequence++,
        kind: 'tool_result',
        content: {
          toolCallId: m.tool_call_id,
          output: stringifyContent(m.content),
        },
      })
    }
  }

  // ── The response message — the new step(s) we add ────────────────────
  const choice = response.choices?.[0]
  const msg = choice?.message
  const toolCalls = msg?.tool_calls ?? []
  const responseText = stringifyContent(msg?.content)
  const reasoningText = stringifyContent(msg?.reasoning_content)

  // If the model exposed its chain-of-thought (reasoning models do), emit a
  // dedicated `thinking` step BEFORE any tool calls / final response. This
  // matches conversation chronology — the model thought, then either called
  // tools or answered — and gives annotators a first-class surface to rate
  // the reasoning independently of the conclusion.
  if (reasoningText) {
    steps.push({
      sequence: sequence++,
      kind: 'thinking',
      content: { text: reasoningText },
      modelName: response.model ?? request.model,
    })
  }

  if (toolCalls.length > 0) {
    for (const tc of toolCalls) {
      steps.push({
        sequence: sequence++,
        kind: 'tool_call',
        content: {
          toolCallId: tc.id,
          toolName: tc.function.name,
          args: parseArgs(tc.function.arguments),
          providerKind: 'function',
        },
        latencyMs: opts.latencyMs,
        tokensIn: response.usage?.prompt_tokens,
        tokensOut: response.usage?.completion_tokens,
        modelName: response.model ?? request.model,
      })
    }
  }
  if (responseText) {
    steps.push({
      sequence: sequence++,
      kind: 'final_response',
      content: { text: responseText },
      latencyMs: toolCalls.length === 0 ? opts.latencyMs : undefined,
      tokensIn: toolCalls.length === 0 ? response.usage?.prompt_tokens : undefined,
      tokensOut:
        toolCalls.length === 0 ? response.usage?.completion_tokens : undefined,
      modelName: response.model ?? request.model,
    })
  }

  // Defensive: schema requires at least one step. If the response was empty
  // AND there was no history, synthesize an `error` step so the row is still
  // useful as a debug artifact rather than getting rejected at the boundary.
  if (steps.length === 0) {
    steps.push({
      sequence: 0,
      kind: 'error',
      content: {
        message: 'Upstream returned no content and no tool calls.',
        code: 'EMPTY_RESPONSE',
      },
    })
  }

  const finalResponse = toolCalls.length === 0 ? responseText : undefined
  const systemPrompt =
    systemPrompts.length > 0 ? systemPrompts.join('\n\n') : null

  // Multi-faceted QC at the capture boundary. We DON'T reject — auditing
  // requires keeping the bytes as-is — but we tag every known failure mode
  // so the annotator never silently labels poison data.
  const qcReasons: Array<{ kind: string; detail?: string }> = []

  // (a) encoding: GBK / Latin-1 mis-decoded as UTF-8 (e.g. Windows curl).
  const enc = inspectTrajectoryEncoding({
    rootPrompt,
    finalResponse,
    systemPrompt,
  })
  if (enc.suspect) {
    qcReasons.push({ kind: 'encoding', detail: enc.fields.join(', ') })
  }

  // (b) truncated: model stopped because of length cap or content filter —
  // the output is INCOMPLETE. Without flagging, an annotator might rate the
  // shortened answer as "wrong" when the model would have been correct given
  // more tokens.
  const finishReason = choice?.finish_reason
  if (finishReason === 'length' || finishReason === 'content_filter') {
    qcReasons.push({ kind: 'truncated', detail: finishReason })
  }

  // (c) empty_response: agent returned nothing useful. Could be a real error
  // or upstream bug — either way, not annotation-grade data.
  if (toolCalls.length === 0 && responseText.trim().length === 0) {
    qcReasons.push({ kind: 'empty_response' })
  }

  const qcFlagsValue =
    qcReasons.length > 0 ? { reasons: qcReasons } : null


  // Gap 1: capture the tool catalog the model was offered. Without this an
  // annotator can't judge "did it pick the right tool" — they only see the
  // chosen call, not the alternatives.
  const toolCatalog: ToolCatalogEntry[] = extractToolCatalog(
    request.tools,
    'openai',
  )

  // Gap 2: record multimodal attachments. Bytes are NOT stored (storage
  // upload is its own iteration); we record kind / mime / size / hash so
  // the annotator at least knows what was attached.
  const attachments: AttachmentRecord[] = extractAttachments(request.messages)

  return {
    agentName: opts.agentName,
    rootPrompt,
    finalResponse,
    source: opts.source,
    schemaVersion: '1.0',
    steps,
    meta: {
      provider: 'openai-compatible',
      requestModel: request.model,
      responseModel: response.model ?? null,
      systemPrompt,
      finishReason: choice?.finish_reason ?? null,
      upstreamId: response.id ?? null,
      usage: response.usage ?? null,
      // ── agent config (Gap 3) ─────────────────────────────────────────
      temperature: request.temperature ?? null,
      maxTokens: request.max_tokens ?? null,
      topP: request.top_p ?? null,
      toolChoice: request.tool_choice ?? null,
      responseFormat: request.response_format ?? null,
      parallelToolCalls: request.parallel_tool_calls ?? null,
      seed: request.seed ?? null,
      stop: request.stop ?? null,
      // ── tool catalog (Gap 1) ─────────────────────────────────────────
      toolCatalog: toolCatalog.length > 0 ? toolCatalog : null,
      // ── attachments (Gap 2) ──────────────────────────────────────────
      attachments: attachments.length > 0 ? attachments : null,
      // ── data integrity flags ─────────────────────────────────────────
      qcFlags: qcFlagsValue,
    },
  }
}
