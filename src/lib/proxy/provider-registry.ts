/**
 * Provider registry — single source of truth for upstream LLM connections.
 *
 * Each provider is defined ONCE in this file: its wire shape family
 * (openai-compat / anthropic-messages / future), default base URL, how to
 * build the upstream auth header, and the path the proxy serves under.
 *
 * Adding a new provider is now a 3-line PR:
 *   1. Add an entry to `PROVIDERS`
 *   2. (Optional) override `defaultBaseUrl` or `apiHeader`
 *   3. Done — the proxy route handler picks it up via `[kind]/[...rest]`
 *
 * The adapter/accumulator logic itself is provider-FAMILY-shared:
 *   - openai-compat → openai-compat-adapter + openai-stream-adapter
 *   - anthropic     → anthropic-messages-adapter + anthropic-stream-adapter
 *
 * So adding DeepSeek (openai-compatible wire shape) is just registry config;
 * adding a completely-new wire shape (e.g. Gemini Pro 2 with their own
 * `generateContent` endpoint) means adding a new family in the adapters
 * folder + registering it.
 */

export type ProviderFamily = 'openai-compat' | 'anthropic'

export interface ProviderDef {
  /** Canonical id used everywhere: DB column, URL segment, UI labels. */
  kind: string
  /** Human-readable name shown in the connections UI. */
  label: string
  /** Which adapter / accumulator pair to use. */
  family: ProviderFamily
  /** Used when a connection doesn't override base_url. */
  defaultBaseUrl: string
  /** Header name carrying the upstream API key. */
  apiHeader: 'authorization-bearer' | 'x-api-key'
  /** Full upstream path appended to baseUrl when forwarding. */
  upstreamPath: string
  /** Env-var fallback name used when no DB connection exists (legacy support). */
  envFallback: string
  /** Optional: extra static headers always sent upstream (e.g. anthropic-version). */
  extraHeaders?: Record<string, string>
}

export const PROVIDERS: Record<string, ProviderDef> = {
  doubao: {
    kind: 'doubao',
    label: 'Doubao (ByteDance ARK)',
    family: 'openai-compat',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiHeader: 'authorization-bearer',
    upstreamPath: '/chat/completions',
    envFallback: 'DOUBAO_API_KEY',
  },
  anthropic: {
    kind: 'anthropic',
    label: 'Anthropic',
    family: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    apiHeader: 'x-api-key',
    upstreamPath: '/v1/messages',
    envFallback: 'ANTHROPIC_API_KEY',
    extraHeaders: {
      'anthropic-version': '2023-06-01',
    },
  },
  // Adding a new OpenAI-compatible provider is now this trivial:
  deepseek: {
    kind: 'deepseek',
    label: 'DeepSeek',
    family: 'openai-compat',
    defaultBaseUrl: 'https://api.deepseek.com',
    apiHeader: 'authorization-bearer',
    upstreamPath: '/chat/completions',
    envFallback: 'DEEPSEEK_API_KEY',
  },
  qwen: {
    kind: 'qwen',
    label: 'Qwen (DashScope OpenAI-compat)',
    family: 'openai-compat',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiHeader: 'authorization-bearer',
    upstreamPath: '/chat/completions',
    envFallback: 'QWEN_API_KEY',
  },
  moonshot: {
    kind: 'moonshot',
    label: 'Moonshot (Kimi)',
    family: 'openai-compat',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    apiHeader: 'authorization-bearer',
    upstreamPath: '/chat/completions',
    envFallback: 'MOONSHOT_API_KEY',
  },
  openai: {
    kind: 'openai',
    label: 'OpenAI',
    family: 'openai-compat',
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiHeader: 'authorization-bearer',
    upstreamPath: '/chat/completions',
    envFallback: 'OPENAI_API_KEY',
  },
}

export function getProviderDef(kind: string): ProviderDef | null {
  return PROVIDERS[kind] ?? null
}

export function listProviders(): ProviderDef[] {
  return Object.values(PROVIDERS)
}

/**
 * Build the upstream auth header for a given provider + plain key.
 */
export function buildUpstreamHeaders(
  def: ProviderDef,
  apiKey: string,
  clientHeaders?: Headers,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(def.extraHeaders ?? {}),
  }
  if (def.apiHeader === 'authorization-bearer') {
    headers['Authorization'] = `Bearer ${apiKey}`
  } else {
    headers['x-api-key'] = apiKey
  }
  // Forward Anthropic-version override + beta from the client if present.
  if (def.family === 'anthropic' && clientHeaders) {
    const version = clientHeaders.get('anthropic-version')
    if (version) headers['anthropic-version'] = version
    const beta = clientHeaders.get('anthropic-beta')
    if (beta) headers['anthropic-beta'] = beta
  }
  return headers
}
