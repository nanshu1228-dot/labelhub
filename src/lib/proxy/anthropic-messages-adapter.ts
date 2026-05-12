/**
 * Anthropic Messages API → canonical trajectory adapter.
 *
 * This is the live-request-response converter used by the proxy route at
 * `/api/proxy/anthropic/v1/messages`. It is INTENTIONALLY separate from
 * `src/lib/trajectories/adapters/anthropic.ts`, which adapts an
 * already-completed Anthropic-shaped trajectory ingested via the SDK path.
 *
 * The Anthropic API shape differs meaningfully from OpenAI's:
 *   - `system` is a top-level field, not a message
 *   - response.content is an ARRAY of typed blocks:
 *       { type: 'text',     text: '...' }
 *       { type: 'tool_use', id, name, input: {...} }
 *       { type: 'thinking', thinking: '...' }   (extended thinking)
 *   - message.content (in conversation history) can be a string OR an array
 *     of tool_result blocks
 *   - tool_use args are JSON objects, NOT JSON-string-encoded
 *   - stop_reason replaces finish_reason
 *
 * Capture semantics: same single-call slice we use for OpenAI-compat. The
 * proxy never executes tools. If a harness loops (call → execute → call),
 * each call yields its own trajectory.
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

// ── Wire types (Anthropic Messages API) ───────────────────────────────────

export interface AnthropicMessagesRequest {
  model: string
  /** Top-level system. Can be a string OR an array of cache-aware blocks. */
  system?: string | Array<{ type: 'text'; text: string; cache_control?: unknown }>
  messages: AnthropicChatMessage[]
  tools?: unknown[]
  /** 'auto' | 'any' | { type: 'tool'; name: string } | { type: 'none' } */
  tool_choice?: unknown
  /** Anthropic equivalent of OpenAI parallel_tool_calls (named differently in some betas) */
  disable_parallel_tool_use?: boolean
  /** Anthropic streaming + thinking config */
  thinking?: unknown
  metadata?: unknown
  service_tier?: string
  stop_sequences?: string[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  top_k?: number
  /** SSE streaming — handled via sse-tee.ts when true. */
  stream?: boolean
  [k: string]: unknown
}

export type AnthropicChatMessage =
  | { role: 'user'; content: string | AnthropicUserBlock[] }
  | { role: 'assistant'; content: string | AnthropicAssistantBlock[] }

export type AnthropicUserBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: string | Array<{ type: 'text'; text: string }>
      is_error?: boolean
    }

export type AnthropicAssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }

export interface AnthropicMessagesResponse {
  id?: string
  type?: 'message'
  role?: 'assistant'
  model?: string
  content: AnthropicAssistantBlock[]
  stop_reason?:
    | 'end_turn'
    | 'tool_use'
    | 'max_tokens'
    | 'stop_sequence'
    | 'pause_turn'
    | string
    | null
  stop_sequence?: string | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
  [k: string]: unknown
}

// ── Adapter ───────────────────────────────────────────────────────────────

export interface AnthropicAdapterOpts {
  agentName: string
  source: TrajectorySource
  latencyMs?: number
}

/** Coerce text-or-block-array content into a flat string. */
function flattenText(
  content:
    | string
    | Array<{ type?: string; text?: string; [k: string]: unknown }>
    | null
    | undefined,
): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content)
  return content
    .map((p) => {
      if (typeof p === 'string') return p
      if (p && typeof p === 'object' && typeof p.text === 'string') return p.text
      return ''
    })
    .join('')
}

/** Flatten Anthropic's `system` field (string OR cache-aware blocks). */
function systemPromptOf(req: AnthropicMessagesRequest): string | null {
  if (!req.system) return null
  if (typeof req.system === 'string') return req.system
  const text = req.system
    .map((b) => (typeof b?.text === 'string' ? b.text : ''))
    .join('\n\n')
  return text || null
}

export function anthropicMessagesToTrajectory(
  request: AnthropicMessagesRequest,
  response: AnthropicMessagesResponse,
  opts: AnthropicAdapterOpts,
): CanonicalTrajectory {
  const steps: CanonicalStep[] = []
  let sequence = 0

  const systemPrompt = systemPromptOf(request)

  // ── rootPrompt: the first user message in the history ──────────────────
  let rootPrompt: string | null = null
  const history = [...request.messages]
  for (let i = 0; i < history.length; i++) {
    const m = history[i]
    if (m.role === 'user') {
      // First user message: extract text-only content. Tool_result blocks at
      // position 0 would be unusual (would mean tool result with no prior call)
      // but we tolerate them by flattening.
      rootPrompt =
        typeof m.content === 'string'
          ? m.content
          : m.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map((b) => b.text)
              .join('')
      history.splice(i, 1)
      break
    }
  }
  if (rootPrompt == null || rootPrompt === '') {
    rootPrompt = '(no user message in request)'
  }

  // ── Prior history → ordered steps ──────────────────────────────────────
  for (const m of history) {
    if (m.role === 'user') {
      // A user turn may contain TEXT (a follow-up) or TOOL_RESULT blocks
      // (results returned to a prior tool_use).
      const blocks =
        typeof m.content === 'string'
          ? [{ type: 'text' as const, text: m.content }]
          : m.content
      for (const b of blocks) {
        if (b.type === 'text') {
          const t = b.text ?? ''
          if (t) {
            steps.push({
              sequence: sequence++,
              kind: 'thinking',
              content: { text: `[user follow-up] ${t}` },
            })
          }
        } else if (b.type === 'tool_result') {
          steps.push({
            sequence: sequence++,
            kind: 'tool_result',
            content: {
              toolCallId: b.tool_use_id,
              output: flattenText(b.content),
              isError: b.is_error ?? false,
            },
          })
        }
      }
    } else if (m.role === 'assistant') {
      const blocks =
        typeof m.content === 'string'
          ? [{ type: 'text' as const, text: m.content }]
          : m.content
      for (const b of blocks) {
        if (b.type === 'text') {
          const t = b.text ?? ''
          if (t) {
            steps.push({
              sequence: sequence++,
              kind: 'thinking',
              content: { text: `[prior assistant] ${t}` },
            })
          }
        } else if (b.type === 'thinking') {
          const t = b.thinking ?? ''
          if (t) {
            steps.push({
              sequence: sequence++,
              kind: 'thinking',
              content: { text: `[prior assistant thinking] ${t}` },
            })
          }
        } else if (b.type === 'tool_use') {
          steps.push({
            sequence: sequence++,
            kind: 'tool_call',
            content: {
              toolCallId: b.id,
              toolName: b.name,
              args: b.input,
              providerKind: 'function',
            },
          })
        }
      }
    }
  }

  // ── This-turn response blocks (the new captured signal) ────────────────
  const respBlocks = response.content ?? []
  const toolCalls = respBlocks.filter(
    (b): b is { type: 'tool_use'; id: string; name: string; input: unknown } =>
      b.type === 'tool_use',
  )
  const thinkings = respBlocks.filter(
    (b): b is { type: 'thinking'; thinking: string } => b.type === 'thinking',
  )
  const texts = respBlocks.filter(
    (b): b is { type: 'text'; text: string } => b.type === 'text',
  )

  // 1) thinking first (chronologically the model thought before deciding)
  for (const th of thinkings) {
    const text = th.thinking ?? ''
    if (text) {
      steps.push({
        sequence: sequence++,
        kind: 'thinking',
        content: { text },
        modelName: response.model ?? request.model,
      })
    }
  }

  // 2) tool_calls (if any — they preempt a final response in this turn)
  for (const tc of toolCalls) {
    steps.push({
      sequence: sequence++,
      kind: 'tool_call',
      content: {
        toolCallId: tc.id,
        toolName: tc.name,
        args: tc.input,
        providerKind: 'function',
      },
      latencyMs: opts.latencyMs,
      tokensIn: response.usage?.input_tokens,
      tokensOut: response.usage?.output_tokens,
      modelName: response.model ?? request.model,
    })
  }

  // 3) final_response — concat any text blocks (Anthropic may emit multiple)
  const finalText = texts.map((t) => t.text).join('')
  if (finalText) {
    steps.push({
      sequence: sequence++,
      kind: 'final_response',
      content: { text: finalText },
      latencyMs: toolCalls.length === 0 ? opts.latencyMs : undefined,
      tokensIn:
        toolCalls.length === 0 ? response.usage?.input_tokens : undefined,
      tokensOut:
        toolCalls.length === 0 ? response.usage?.output_tokens : undefined,
      modelName: response.model ?? request.model,
    })
  }

  // Defensive: an empty response with no history still produces a captureable
  // row (so the audit log is useful), via a synthesized error step.
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

  const finalResponse = toolCalls.length === 0 ? finalText : undefined

  // ── QC flags (same set we use for OpenAI compat) ───────────────────────
  const qcReasons: Array<{ kind: string; detail?: string }> = []
  const enc = inspectTrajectoryEncoding({
    rootPrompt,
    finalResponse,
    systemPrompt,
  })
  if (enc.suspect) {
    qcReasons.push({ kind: 'encoding', detail: enc.fields.join(', ') })
  }
  const stopReason = response.stop_reason
  if (stopReason === 'max_tokens') {
    qcReasons.push({ kind: 'truncated', detail: 'max_tokens' })
  }
  if (toolCalls.length === 0 && finalText.trim().length === 0) {
    qcReasons.push({ kind: 'empty_response' })
  }
  const qcFlagsValue = qcReasons.length > 0 ? { reasons: qcReasons } : null

  // Gap 1: tool catalog the model was offered (separate from chosen tool_calls).
  const toolCatalog: ToolCatalogEntry[] = extractToolCatalog(
    request.tools,
    'anthropic',
  )
  // Gap 2: attachments — bytes not uploaded yet; metadata recorded.
  const attachments: AttachmentRecord[] = extractAttachments(
    request.messages.map((m) => ({ content: m.content })),
  )

  return {
    agentName: opts.agentName,
    rootPrompt,
    finalResponse,
    source: opts.source,
    schemaVersion: '1.0',
    steps,
    meta: {
      provider: 'anthropic',
      requestModel: request.model,
      responseModel: response.model ?? null,
      systemPrompt,
      stopReason: stopReason ?? null,
      stopSequence: response.stop_sequence ?? null,
      upstreamId: response.id ?? null,
      usage: response.usage ?? null,
      // ── agent config (Gap 3) ─────────────────────────────────────────
      temperature: request.temperature ?? null,
      maxTokens: request.max_tokens ?? null,
      topP: request.top_p ?? null,
      topK: request.top_k ?? null,
      toolChoice: request.tool_choice ?? null,
      disableParallelToolUse: request.disable_parallel_tool_use ?? null,
      thinking: request.thinking ?? null,
      serviceTier: request.service_tier ?? null,
      stopSequences: request.stop_sequences ?? null,
      // ── tool catalog (Gap 1) ─────────────────────────────────────────
      toolCatalog: toolCatalog.length > 0 ? toolCatalog : null,
      // ── attachments (Gap 2) ──────────────────────────────────────────
      attachments: attachments.length > 0 ? attachments : null,
      // ── data integrity flags ─────────────────────────────────────────
      qcFlags: qcFlagsValue,
    },
  }
}
