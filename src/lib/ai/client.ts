import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

/**
 * Provider-agnostic LLM client.
 *
 * Every server-side AI feature (spec-generator, trajectory-reviewer,
 * topic-scope, guideline-refiner, pair-suggester) routes through `chat()`
 * here, NOT through provider SDKs directly. Swapping providers is then a
 * one-env-var change instead of a 5-file refactor.
 *
 * Selection precedence (cheapest swap path first):
 *
 *   1. `AI_DEFAULT_PROVIDER` env var — explicit choice, always wins.
 *      Values: 'doubao' | 'anthropic' | 'deepseek' | 'moonshot' | 'qwen' | 'openai'
 *   2. Otherwise: the FIRST provider whose `*_API_KEY` env is set (non-empty).
 *      Order: anthropic → doubao → deepseek → moonshot → qwen → openai.
 *      So if Anthropic IS configured, default is Anthropic; if only Doubao
 *      is configured, default is Doubao; etc.
 *   3. Otherwise: throw with a clear message — no silent failure.
 *
 * Tier mapping:
 *   The caller asks for `fast` / `default` / `premium`, the dispatcher
 *   resolves it to a concrete model name on the chosen provider. Each
 *   provider has its own ladder (e.g. Anthropic's fast = Haiku-4.5,
 *   Doubao's fast = doubao-seed-lite). Callers don't hard-code model
 *   names; that's how this stays portable.
 */

// ─── Public types ───────────────────────────────────────────────────────

export type ProviderKind =
  | 'anthropic'
  | 'doubao'
  | 'deepseek'
  | 'moonshot'
  | 'qwen'
  | 'openai'

export type Tier = 'fast' | 'default' | 'premium'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * A callable tool / function the model may (or must) invoke — the portable
 * shape of Anthropic tool-use and OpenAI function-calling. `inputSchema` is a
 * JSON Schema object describing the arguments; the dispatcher maps it to each
 * provider's wire format (`input_schema` for Anthropic, `function.parameters`
 * for the OpenAI-compat backends).
 */
export interface ChatTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
    [k: string]: unknown
  }
}

/**
 * How the model is allowed to use the supplied tools:
 *   - `{type:'auto'}`        — model decides (default when tools are present)
 *   - `{type:'tool', name}`  — FORCE the model to call exactly this tool.
 * Forcing a single tool is how we get guaranteed structured output (spec 4.4
 * Function Calling / 结构化裁决): the model cannot answer in free prose.
 */
export type ChatToolChoice = { type: 'auto' } | { type: 'tool'; name: string }

/** The structured arguments the model passed to a tool, when it called one. */
export interface ChatToolUse {
  name: string
  /** Parsed tool arguments (already JSON-decoded). Validate with your schema. */
  input: unknown
}

export interface ChatRequest {
  /**
   * System prompt. A plain string is the common case; pass an array of
   * `{text, cacheSystem: true}` blocks when you want to mark the system as
   * cacheable (Anthropic prompt caching; ignored by other providers).
   */
  system: string
  messages: ChatMessage[]
  maxTokens: number
  tier?: Tier
  /**
   * When 'json_object', sets the provider's JSON-output mode if supported.
   * Anthropic has no native JSON mode — the caller's prompt MUST already
   * instruct "output ONLY the JSON object". This flag is a soft hint.
   */
  responseFormat?: 'text' | 'json_object'
  /**
   * Tools the model may call. Mapped to Anthropic `tools` / OpenAI-compat
   * `tools:[{type:'function'}]`. When you pass `toolChoice:{type:'tool',name}`
   * the model is FORCED to call it, yielding guaranteed structured output in
   * {@link ChatResponse.toolUse}.
   */
  tools?: ChatTool[]
  /** Tool-use policy (see {@link ChatToolChoice}). Ignored when no `tools`. */
  toolChoice?: ChatToolChoice
  /**
   * Sampling temperature. Omit to use the provider default. Pass `0` for
   * greedy/deterministic decoding — the AI review agent does this so a given
   * submission + config reproduces the same score (spec §5 评分稳定性).
   * Mapped to Anthropic `temperature` and OpenAI-compat `temperature`.
   */
  temperature?: number
  /** Nucleus sampling. Omit for provider default. */
  topP?: number
  /**
   * Deterministic seed (OpenAI / DeepSeek honor it; Anthropic ignores — it has
   * no seed param, so determinism there comes from temperature 0). Omit for none.
   */
  seed?: number
  /** Anthropic: mark system as cacheable. Ignored elsewhere. */
  cacheSystem?: boolean
  /**
   * Diagnostic label used in the daily-quota log to attribute the call.
   * Encouraged but not required.
   */
  feature?: string
}

export interface ChatUsage {
  /** Concrete model name reported by the provider. */
  model: string
  inputTokens: number
  outputTokens: number
  /** The provider kind used. Useful for logs / audit. */
  provider: ProviderKind
}

export interface ChatResponse {
  /** The model's reply text. Already extracted from provider-specific shapes. */
  text: string
  /**
   * Present when the model called a tool (see {@link ChatRequest.tools}). With
   * a forced `toolChoice`, this is the structured result and `text` is usually
   * empty. Absent on plain text responses.
   */
  toolUse?: ChatToolUse
  usage: ChatUsage
}

// ─── Tier → model ladders (per provider) ────────────────────────────────

const ANTHROPIC_MODELS: Record<Tier, string> = {
  fast: 'claude-haiku-4-5-20251001',
  default: 'claude-sonnet-4-6',
  premium: 'claude-opus-4-7',
}

const DOUBAO_MODELS: Record<Tier, string> = {
  // Verified working in production via the proxy guardrail demo.
  fast: 'doubao-seed-2-0-lite-260428',
  default: 'doubao-seed-2-0-lite-260428',
  premium: 'doubao-seed-2-0-lite-260428',
  // Callers wanting a bigger Doubao model can pass it as DOUBAO_MODEL_DEFAULT
  // override (see resolveModel below) — keeps this file from going stale as
  // ByteDance ships new SKUs.
}

const DEEPSEEK_MODELS: Record<Tier, string> = {
  fast: 'deepseek-chat',
  default: 'deepseek-chat',
  premium: 'deepseek-reasoner',
}

const MOONSHOT_MODELS: Record<Tier, string> = {
  fast: 'moonshot-v1-8k',
  default: 'moonshot-v1-32k',
  premium: 'moonshot-v1-128k',
}

const QWEN_MODELS: Record<Tier, string> = {
  fast: 'qwen-turbo',
  default: 'qwen-plus',
  premium: 'qwen-max',
}

const OPENAI_MODELS: Record<Tier, string> = {
  fast: 'gpt-5-mini',
  default: 'gpt-5',
  premium: 'gpt-5',
}

const TIER_LADDERS: Record<ProviderKind, Record<Tier, string>> = {
  anthropic: ANTHROPIC_MODELS,
  doubao: DOUBAO_MODELS,
  deepseek: DEEPSEEK_MODELS,
  moonshot: MOONSHOT_MODELS,
  qwen: QWEN_MODELS,
  openai: OPENAI_MODELS,
}

const ENV_KEY_FOR: Record<ProviderKind, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  doubao: 'DOUBAO_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  qwen: 'QWEN_API_KEY',
  openai: 'OPENAI_API_KEY',
}

const OPENAI_COMPAT_BASE: Record<Exclude<ProviderKind, 'anthropic'>, string> = {
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  deepseek: 'https://api.deepseek.com',
  moonshot: 'https://api.moonshot.cn/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  openai: 'https://api.openai.com/v1',
}

/**
 * Which OpenAI-compat providers support `response_format: {type:'json_object'}`.
 *
 * Doubao's `seed-lite` model rejects it with `InvalidParameter` —
 * BadRequest 400. Their newer Pro models DO support it. For now we
 * blanket-disable for Doubao; when callers move to Pro they can flip
 * the entry below (or add a per-model check).
 *
 * Our prompts ALREADY say "Output ONLY the JSON object" so dropping the
 * `response_format` parameter is safe — we get the same behavior.
 *
 * Verified-supports list maintained by hand. When in doubt, default false:
 * worst case is a model returns markdown-fenced JSON which the caller's
 * `stripCodeFences` already handles.
 */
const SUPPORTS_JSON_MODE: Record<Exclude<ProviderKind, 'anthropic'>, boolean> = {
  doubao: false,
  deepseek: true,
  moonshot: true,
  qwen: true,
  openai: true,
}

// ─── Provider resolution ────────────────────────────────────────────────

/**
 * Look at env to determine which provider is the "default" for this process.
 * Cached for the lifetime of the module — provider doesn't change at runtime.
 */
let _resolvedProvider: ProviderKind | null = null

/**
 * Cheap check: does ANY known provider have its key set?
 *
 * Useful for UI surfaces that want to render "AI feature unavailable —
 * set a provider key" without trying the call. Doesn't throw, doesn't
 * cache (env may change in dev), and ignores whichever provider was
 * explicitly pinned via `AI_DEFAULT_PROVIDER` — the question is
 * "could the call work at all?" not "is the preferred provider ready?"
 */
export function isAnyProviderConfigured(): boolean {
  for (const p of Object.values(ENV_KEY_FOR)) {
    const v = process.env[p]
    if (v && v.trim().length > 0) return true
  }
  return false
}

export function resolveDefaultProvider(): ProviderKind {
  if (_resolvedProvider) return _resolvedProvider

  const explicit = process.env.AI_DEFAULT_PROVIDER?.toLowerCase()
  if (explicit && isProviderKind(explicit)) {
    const key = process.env[ENV_KEY_FOR[explicit]]
    if (key && key.trim().length > 0) {
      _resolvedProvider = explicit
      return explicit
    }
    throw new Error(
      `AI_DEFAULT_PROVIDER=${explicit} but ${ENV_KEY_FOR[explicit]} is not set. Either set the key or remove AI_DEFAULT_PROVIDER to fall through to auto-detect.`,
    )
  }

  // Auto-detect: pick the first configured provider in preference order.
  const order: ProviderKind[] = [
    'anthropic',
    'doubao',
    'deepseek',
    'moonshot',
    'qwen',
    'openai',
  ]
  for (const p of order) {
    const key = process.env[ENV_KEY_FOR[p]]
    if (key && key.trim().length > 0) {
      _resolvedProvider = p
      return p
    }
  }
  throw new Error(
    'No AI provider configured. Set one of ' +
      order.map((p) => ENV_KEY_FOR[p]).join(', ') +
      ' (and optionally AI_DEFAULT_PROVIDER to pin which one to use).',
  )
}

function isProviderKind(s: string): s is ProviderKind {
  return s in TIER_LADDERS
}

function resolveModel(provider: ProviderKind, tier: Tier): string {
  // Per-provider override env: e.g. DOUBAO_MODEL_DEFAULT lets you point the
  // 'default' tier at a different Doubao SKU without code changes. Used in
  // production when ByteDance ships a new model name we haven't baked in.
  const overrideKey = `${provider.toUpperCase()}_MODEL_${tier.toUpperCase()}`
  const override = process.env[overrideKey]
  if (override && override.trim().length > 0) return override.trim()
  return TIER_LADDERS[provider][tier]
}

// ─── The chat() dispatcher ──────────────────────────────────────────────

/**
 * Send a chat request. Provider is resolved per-call from env so unit tests
 * can swap by setting the env var; in normal runtime it's stable.
 */
export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const provider = resolveDefaultProvider()
  const tier: Tier = req.tier ?? 'default'
  const model = resolveModel(provider, tier)

  if (provider === 'anthropic') {
    return chatAnthropic(req, model)
  }
  return chatOpenAICompat(req, provider, model)
}

// ── Anthropic backend ──────────────────────────────────────────────────

let _anthropic: Anthropic | null = null
function getAnthropicClient(): Anthropic {
  if (_anthropic) return _anthropic
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set.')
  _anthropic = new Anthropic({ apiKey: key })
  return _anthropic
}

async function chatAnthropic(
  req: ChatRequest,
  model: string,
): Promise<ChatResponse> {
  const client = getAnthropicClient()
  const systemBlocks = req.cacheSystem
    ? [
        {
          type: 'text' as const,
          text: req.system,
          cache_control: { type: 'ephemeral' as const },
        },
      ]
    : req.system

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: req.maxTokens,
    system: systemBlocks,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  }
  // Determinism controls (spec §5 评分稳定性). Anthropic has no seed param;
  // temperature 0 is how the review agent gets reproducible scoring.
  if (req.temperature !== undefined) params.temperature = req.temperature
  if (req.topP !== undefined) params.top_p = req.topP
  // Native Anthropic tool-use (spec 4.4 Function Calling). Forcing a single
  // tool via tool_choice guarantees the model returns structured args.
  if (req.tools && req.tools.length > 0) {
    params.tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))
    params.tool_choice =
      req.toolChoice?.type === 'tool'
        ? { type: 'tool', name: req.toolChoice.name }
        : { type: 'auto' }
  }

  const response = await client.messages.create(params)

  const textBlock = response.content.find((b) => b.type === 'text')
  const toolBlock = response.content.find((b) => b.type === 'tool_use')
  const text = textBlock && textBlock.type === 'text' ? textBlock.text : ''
  const toolUse =
    toolBlock && toolBlock.type === 'tool_use'
      ? { name: toolBlock.name, input: toolBlock.input }
      : undefined

  if (text === '' && !toolUse) {
    throw new Error('chat(anthropic): no text or tool_use content in response')
  }

  return {
    text,
    toolUse,
    usage: {
      provider: 'anthropic',
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  }
}

// ── OpenAI-compat backend (Doubao / DeepSeek / Moonshot / Qwen / OpenAI) ──

async function chatOpenAICompat(
  req: ChatRequest,
  provider: Exclude<ProviderKind, 'anthropic'>,
  model: string,
): Promise<ChatResponse> {
  const apiKey = process.env[ENV_KEY_FOR[provider]]
  if (!apiKey) throw new Error(`${ENV_KEY_FOR[provider]} not set.`)

  // Per-provider base URL override (so users can hit a regional endpoint
  // or a self-hosted reverse proxy without code change).
  const baseOverrideKey = `${provider.toUpperCase()}_BASE_URL`
  const baseUrl =
    process.env[baseOverrideKey]?.trim() || OPENAI_COMPAT_BASE[provider]

  // OpenAI-compatible body. JSON mode is opt-in via responseFormat='json_object',
  // BUT some providers (Doubao seed-lite) reject the parameter even though they
  // speak OpenAI-compat otherwise. We gate the parameter on a per-provider
  // capability flag and rely on the prompt's "Output ONLY JSON" instruction
  // when the provider doesn't natively support the mode.
  const body: Record<string, unknown> = {
    model,
    max_tokens: req.maxTokens,
    messages: [
      { role: 'system', content: req.system },
      ...req.messages,
    ],
  }
  // Determinism controls (spec §5 评分稳定性). temperature is universally
  // supported; seed is honored by OpenAI/DeepSeek (ignored harmlessly elsewhere).
  if (req.temperature !== undefined) body.temperature = req.temperature
  if (req.topP !== undefined) body.top_p = req.topP
  if (req.seed !== undefined) body.seed = req.seed
  if (req.responseFormat === 'json_object' && SUPPORTS_JSON_MODE[provider]) {
    body.response_format = { type: 'json_object' }
  }
  // OpenAI-compatible function-calling: map portable ChatTool → the
  // `tools:[{type:'function'}]` wire shape. Forcing a tool guarantees
  // structured arguments (the same role native tool-use plays on Anthropic).
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }))
    body.tool_choice =
      req.toolChoice?.type === 'tool'
        ? { type: 'function', function: { name: req.toolChoice.name } }
        : 'auto'
  }

  const url = `${baseUrl}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '<unreadable>')
    throw new Error(
      `chat(${provider}): ${res.status} ${res.statusText} — ${errText.slice(0, 500)}`,
    )
  }

  type OpenAICompatResponse = {
    id?: string
    model?: string
    choices: Array<{
      message: {
        role: string
        content: string | null
        tool_calls?: Array<{
          id?: string
          type?: string
          function: { name: string; arguments: string }
        }>
      }
      finish_reason?: string
    }>
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      input_tokens?: number
      output_tokens?: number
    }
  }
  const data = (await res.json()) as OpenAICompatResponse
  const message = data.choices?.[0]?.message

  // Function-call result (when tools were supplied). arguments is a JSON
  // string; decode it into the portable toolUse shape.
  const toolCall = message?.tool_calls?.[0]
  let toolUse: ChatToolUse | undefined
  if (toolCall?.function) {
    let input: unknown = {}
    try {
      input = JSON.parse(toolCall.function.arguments || '{}')
    } catch {
      input = {}
    }
    toolUse = { name: toolCall.function.name, input }
  }

  const content = message?.content
  const text = typeof content === 'string' ? content : ''
  if (text === '' && !toolUse) {
    throw new Error(
      `chat(${provider}): response has no text or tool_call content. Body: ${JSON.stringify(data).slice(0, 500)}`,
    )
  }

  // Both prompt_tokens/completion_tokens and input_tokens/output_tokens occur
  // in the wild — Doubao uses the former, some providers use the latter.
  const inputTokens =
    data.usage?.input_tokens ?? data.usage?.prompt_tokens ?? 0
  const outputTokens =
    data.usage?.output_tokens ?? data.usage?.completion_tokens ?? 0

  return {
    text,
    toolUse,
    usage: {
      provider,
      model: data.model ?? model,
      inputTokens,
      outputTokens,
    },
  }
}
