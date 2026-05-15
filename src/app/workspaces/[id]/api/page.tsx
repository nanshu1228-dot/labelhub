import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { apiRequestLog } from '@/lib/db/schema'
import {
  optionalUser,
  requireWorkspaceAdmin,
} from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import {
  listApiKeysWithStatus,
  getWorkspaceApiUsage,
} from '@/lib/queries/api-keys'
import { ExampleTabs } from '@/components/api/example-tabs'
import {
  listProviders,
  type ProviderDef,
} from '@/lib/proxy/provider-registry'
import { resolveTopicScope } from '@/lib/queries/topic-scope'
import { TopicScopeAdmin } from '@/components/api/topic-scope-admin'

export const metadata: Metadata = {
  title: 'API — LabelHub',
}

/**
 * /workspaces/[id]/api
 *
 * "What does this workspace expose to the outside world, and who's been
 * hitting it." Three sections:
 *   1. ENDPOINTS — static catalog with copy-pasteable curl examples
 *   2. API KEYS — workspace_api_keys rows (masked prefix only)
 *   3. RECENT CALLS — last 20 rows from api_request_log
 *
 * Read-only for now. Key creation / revocation belong behind a real auth
 * session, not in a public route. Today we mint keys with
 *   npm run bootstrap          (creates) / --rotate (revokes prior)
 */
export default async function ApiManagementPage(
  props: PageProps<'/workspaces/[id]/api'>,
) {
  const { id: workspaceId } = await props.params

  // Admin-only — API key prefixes + usage logs are operational secrets
  // even though plain keys never leave the DB.
  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${workspaceId}/api`)
  try {
    await requireWorkspaceAdmin(workspaceId)
  } catch {
    notFound()
  }

  let workspaceName = 'workspace'
  let dbError: string | null = null
  let keys: Awaited<ReturnType<typeof listApiKeysWithStatus>> = []
  let usage: Awaited<ReturnType<typeof getWorkspaceApiUsage>> | null = null
  let recentLog: Array<typeof apiRequestLog.$inferSelect> = []
  let topicScope: Awaited<ReturnType<typeof resolveTopicScope>> = null

  try {
    const workspace = await getWorkspaceById(workspaceId)
    if (!workspace) notFound()
    workspaceName = workspace.name
    const db = getDb()
    ;[keys, usage, recentLog, topicScope] = await Promise.all([
      listApiKeysWithStatus(workspaceId),
      getWorkspaceApiUsage(workspaceId),
      db
        .select()
        .from(apiRequestLog)
        .where(eq(apiRequestLog.workspaceId, workspaceId))
        .orderBy(desc(apiRequestLog.ts))
        .limit(20),
      resolveTopicScope({ workspaceId }),
    ])
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="app-light min-h-screen">
      <Header workspaceId={workspaceId} workspaceName={workspaceName} />

      <main className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="mb-8">
          <div className="lbl mb-2">§ API SURFACE</div>
          <h1 className="ts-32" style={{ color: 'var(--hi)' }}>
            API
          </h1>
          <p className="ts-13 mt-1" style={{ color: 'var(--mute)' }}>
            What this workspace exposes to machine clients — and who&apos;s been
            calling.
          </p>
        </div>

        {dbError ? (
          <DbError message={dbError} />
        ) : (
          <div className="flex flex-col gap-10">
            <EndpointsSection workspaceId={workspaceId} />
            <TopicScopeAdmin
              workspaceId={workspaceId}
              scope={topicScope}
            />
            <LimitationsSection />
            <KeysSection keys={keys} />
            <UsageSection usage={usage} />
            <RecentCallsSection rows={recentLog} />
          </div>
        )}
      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Header

function Header({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string
  workspaceName: string
}) {
  return (
    <header
      className="hairline-b sticky top-0 z-10"
      style={{ background: 'var(--panel)' }}
    >
      <div className="mx-auto max-w-[1200px] flex items-center justify-between px-6 py-3">
        <nav
          className="ts-12 mono flex items-center gap-1.5"
          style={{ color: 'var(--mute2)' }}
        >
          <Link
            href={`/workspaces/${workspaceId}`}
            className="truncate-1 hover:underline"
            style={{ color: 'var(--text)', maxWidth: 200 }}
          >
            {workspaceName}
          </Link>
          <span>/</span>
          <span style={{ color: 'var(--hi)' }}>api</span>
        </nav>
        <div className="flex items-center gap-4">
          <Link
            href={`/workspaces/${workspaceId}/trajectories`}
            className="ts-12 mono hover:underline"
            style={{ color: 'var(--mute)' }}
          >
            captured trajectories
          </Link>
          <Link
            href="/"
            className="ts-13 mono"
            style={{ color: 'var(--hi)' }}
            aria-label="LabelHub"
          >
            <span style={{ color: 'var(--accent)' }}>§</span> labelhub
          </Link>
        </div>
      </div>
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Endpoints catalog

interface EndpointSpec {
  method: 'POST' | 'GET'
  path: string
  title: string
  blurb: string
  auth: 'bearer-workspace-key' | 'user-session'
  /** Map of snippet label → code body. Tabs in UI. First entry is the default. */
  examples: Record<string, string>
}

// Sensible "hello world" model + sample prompt per provider for code examples.
// Not the source of truth (registry is) — just demo affordances.
const PROVIDER_DEMO: Record<
  string,
  { exampleModel: string; samplePrompt: string }
> = {
  doubao: {
    exampleModel: 'doubao-seed-2-0-lite-260428',
    samplePrompt: '用一句话介绍你自己。',
  },
  anthropic: {
    exampleModel: 'claude-sonnet-4-6',
    samplePrompt: 'What is 2+2?',
  },
  openai: { exampleModel: 'gpt-4o-mini', samplePrompt: 'What is 2+2?' },
  deepseek: { exampleModel: 'deepseek-chat', samplePrompt: 'What is 2+2?' },
  qwen: { exampleModel: 'qwen-plus', samplePrompt: 'What is 2+2?' },
  moonshot: { exampleModel: 'moonshot-v1-8k', samplePrompt: 'What is 2+2?' },
}

/** Build the Examples block for one provider, branching on its family. */
function buildProviderExamples(
  p: ProviderDef,
  base: string,
  key: string,
): Record<string, string> {
  const demo = PROVIDER_DEMO[p.kind] ?? {
    exampleModel: 'MODEL_NAME',
    samplePrompt: 'Hello',
  }
  const proxyBase = `${base}/api/proxy/${p.kind}`
  const fullUrl = `${proxyBase}${p.upstreamPath}`

  if (p.family === 'anthropic') {
    return {
      'Claude Code': `# Two env vars. Then start Claude Code as usual.
export ANTHROPIC_BASE_URL=${proxyBase}
export ANTHROPIC_API_KEY=${key}

claude   # every messages.create() call is now captured`,
      'Python SDK': `from anthropic import Anthropic

client = Anthropic(
    base_url="${proxyBase}",
    api_key="${key}",  # workspace key, NOT sk-ant-...
)
resp = client.messages.create(
    model="${demo.exampleModel}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "${demo.samplePrompt}"}],
)
print(resp.content[0].text)`,
      'TypeScript SDK': `import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  baseURL: '${proxyBase}',
  apiKey: '${key}',  // workspace key
})
const resp = await client.messages.create({
  model: '${demo.exampleModel}',
  max_tokens: 1024,
  messages: [{ role: 'user', content: '${demo.samplePrompt}' }],
})
console.log(resp.content[0])`,
      curl: `curl -sS -X POST ${fullUrl} \\
  -H 'x-api-key: ${key}' \\
  -H 'anthropic-version: 2023-06-01' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "${demo.exampleModel}",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "${demo.samplePrompt}"}
    ]
  }'`,
    }
  }

  // openai-compat default
  return {
    'Python SDK': `from openai import OpenAI

client = OpenAI(
    base_url="${proxyBase}",
    api_key="${key}",  # workspace key (NOT the upstream provider key)
)
resp = client.chat.completions.create(
    model="${demo.exampleModel}",
    messages=[{"role": "user", "content": "${demo.samplePrompt}"}],
)
print(resp.choices[0].message.content)`,
    'TypeScript SDK': `import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: '${proxyBase}',
  apiKey: '${key}',  // workspace key
})
const resp = await client.chat.completions.create({
  model: '${demo.exampleModel}',
  messages: [{ role: 'user', content: '${demo.samplePrompt}' }],
})
console.log(resp.choices[0].message.content)`,
    LangChain: `# pip install langchain-openai
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="${demo.exampleModel}",
    openai_api_base="${proxyBase}",
    openai_api_key="${key}",
)
print(llm.invoke([{"role": "user", "content": "${demo.samplePrompt}"}]).content)`,
    curl: `curl -sS -X POST ${fullUrl} \\
  -H 'Authorization: Bearer ${key}' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "${demo.exampleModel}",
    "messages": [
      {"role": "user", "content": "${demo.samplePrompt}"}
    ]
  }'`,
  }
}

function buildEndpoints(workspaceId: string): EndpointSpec[] {
  const KEY_PLACEHOLDER = 'lh_ws_…'
  const base = 'http://localhost:3000'

  // Auto-generate one proxy endpoint per registered provider. Adding a new
  // upstream LLM provider = 3 lines in `provider-registry.ts` and it shows
  // up here automatically.
  const proxyEndpoints: EndpointSpec[] = listProviders().map((p) => ({
    method: 'POST',
    path: `/api/proxy/${p.kind}${p.upstreamPath}`,
    title:
      p.family === 'anthropic'
        ? `${p.label} transparent proxy (Claude Code drop-in)`
        : `${p.label} transparent proxy (OpenAI-compatible)`,
    blurb:
      p.family === 'anthropic'
        ? `Forward Anthropic Messages API calls to ${p.defaultBaseUrl} while capturing the full conversation. Claude Code, the Anthropic SDK, and any harness that respects ANTHROPIC_BASE_URL works out of the box.`
        : `Forward OpenAI-compatible chat completions to ${p.defaultBaseUrl} while capturing the full conversation. Drop-in for OpenAI / LangChain / LlamaIndex / any client with a custom baseURL. Reasoning models' \`reasoning_content\` is captured as a separate thinking step.`,
    auth: 'bearer-workspace-key',
    examples: buildProviderExamples(p, base, KEY_PLACEHOLDER),
  }))

  return [
    ...proxyEndpoints,
    {
      method: 'POST',
      path: '/api/ingest/trajectories',
      title: 'SDK trajectory ingest',
      blurb:
        'Push an already-completed trajectory in canonical / anthropic / openai-assistants format. Used by your production agent SDK to mirror real traffic into LabelHub for annotation, without a proxy hop. Auto-detects the format; override with X-LabelHub-Format.',
      auth: 'bearer-workspace-key',
      examples: {
        curl: `curl -sS -X POST ${base}/api/ingest/trajectories \\
  -H 'Authorization: Bearer ${KEY_PLACEHOLDER}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-LabelHub-Format: canonical' \\
  -H 'X-LabelHub-Agent-Name: travel-planner-v2' \\
  -d '{
    "schemaVersion": "1.0",
    "source": "production",
    "agentName": "travel-planner-v2",
    "rootPrompt": "Plan 3-day Tokyo trip.",
    "finalResponse": "Day 1 Asakusa...",
    "steps": [
      {"sequence": 0, "kind": "thinking",
       "content": {"text": "Let me check flights first."}},
      {"sequence": 1, "kind": "tool_call",
       "content": {"toolCallId": "tc_001", "toolName": "search_flights",
                   "args": {"origin": "PVG", "dest": "NRT"},
                   "providerKind": "function"}},
      {"sequence": 2, "kind": "tool_result",
       "content": {"toolCallId": "tc_001", "output": "{\\"price\\":1080}"}},
      {"sequence": 3, "kind": "final_response",
       "content": {"text": "Day 1 Asakusa..."}}
    ]
  }'`,
      },
    },
    {
      method: 'GET',
      path: '/api/trajectories',
      title: 'List captured trajectories',
      blurb:
        'Programmatically list trajectories for this workspace. Use the workspace key — the workspace is inferred from the key, never passed as a query param. Supports filters by agent name (ILIKE), source allow-list, and a createdAt range.',
      auth: 'bearer-workspace-key',
      examples: {
        curl: `curl -sS '${base}/api/trajectories?source=production&limit=20' \\
  -H 'Authorization: Bearer ${KEY_PLACEHOLDER}'

# Response (truncated):
# {
#   "trajectories": [
#     {
#       "id": "0b89afda-…",
#       "agentName": "anthropic/claude-sonnet-4-6",
#       "rootPrompt": "...",
#       "finalResponse": "...",
#       "meta": { "qcFlags": null, "usage": {...} },
#       "createdAt": "2026-05-12T..."
#     }
#   ],
#   "total": 4,
#   "hasMore": false
# }`,
        Python: `import httpx

r = httpx.get(
    "${base}/api/trajectories",
    params={"source": "production", "limit": 20},
    headers={"Authorization": "Bearer ${KEY_PLACEHOLDER}"},
)
data = r.json()
for t in data["trajectories"]:
    print(t["id"], t["agentName"], t["rootPrompt"][:60])`,
      },
    },
    {
      method: 'GET',
      path: '/api/trajectories/[id]',
      title: 'Get one trajectory with full steps',
      blurb:
        'Retrieve a single trajectory along with every step and every tool_provider it references. The same data the detail page renders — ready to pipe into your training set, eval harness, or custom annotation tool.',
      auth: 'bearer-workspace-key',
      examples: {
        curl: `curl -sS '${base}/api/trajectories/<trajectoryId>' \\
  -H 'Authorization: Bearer ${KEY_PLACEHOLDER}'

# Response:
# {
#   "trajectory": { "id": "...", "rootPrompt": "...", "meta": {...}, ... },
#   "steps": [
#     { "sequence": 0, "kind": "thinking", "content": {"text": "..."}, ... },
#     { "sequence": 1, "kind": "tool_call", "content": {"toolName": "...", ...} }
#   ],
#   "toolProviders": {
#     "<uuid>": { "kind": "function", "identifier": "function:get_weather", ... }
#   }
# }`,
      },
    },
    {
      method: 'POST',
      path: '/api/eval-runs',
      title: 'Managed Eval-Run',
      blurb:
        'Spin up a simulated agent run inside LabelHub — Sonnet 4.6 as the agent, Haiku 4.5 as the tool simulator. Same canonical trajectory comes back. Used by the in-app Eval-Run page; also callable directly.',
      auth: 'user-session',
      examples: {
        UI: `# Currently requires an authenticated user session.
# Trigger via the UI at /workspaces/${workspaceId}/eval-runs/new`,
      },
    },
    {
      method: 'GET',
      path: '/api/export/trajectories',
      title: 'JSONL bulk export',
      blurb:
        'Stream the workspace\'s trajectories + annotations as JSONL — one JSON object per line. Admin-only (anchored by user session, not workspace keys) so consumer access goes through the read APIs above instead.',
      auth: 'user-session',
      examples: {
        curl: `curl -sS '${base}/api/export/trajectories?workspaceId=${workspaceId}&limit=100&sources=production,eval-run' \\
  -b 'session-cookie-here' \\
  -o trajectories.jsonl`,
      },
    },
  ]
}

function EndpointsSection({ workspaceId }: { workspaceId: string }) {
  const endpoints = buildEndpoints(workspaceId)
  return (
    <section>
      <SectionHeader title="ENDPOINTS" hint={`${endpoints.length} routes`} />
      <div className="flex flex-col gap-3">
        {endpoints.map((e) => (
          <EndpointCard key={e.path} spec={e} />
        ))}
      </div>
    </section>
  )
}

function EndpointCard({ spec }: { spec: EndpointSpec }) {
  return (
    <article
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <header
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hairline-b"
        style={{ background: 'var(--panel2)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="badge"
            style={{
              color: spec.method === 'POST' ? 'var(--accent)' : 'var(--success)',
              borderColor:
                spec.method === 'POST'
                  ? 'var(--accent-line)'
                  : 'oklch(0.65 0.13 150 / 0.4)',
              background:
                spec.method === 'POST'
                  ? 'var(--accent-soft)'
                  : 'var(--success-soft)',
            }}
          >
            {spec.method}
          </span>
          <span
            className="ts-13 mono truncate-1"
            style={{ color: 'var(--hi)' }}
          >
            {spec.path}
          </span>
        </div>
        <AuthBadge auth={spec.auth} />
      </header>
      <div className="px-4 pt-3 pb-2">
        <div className="ts-13 mb-1" style={{ color: 'var(--hi)' }}>
          {spec.title}
        </div>
        <p
          className="ts-13"
          style={{ color: 'var(--mute)', lineHeight: 1.55 }}
        >
          {spec.blurb}
        </p>
      </div>
      <div className="px-4 pb-4 pt-1">
        <ExampleTabs examples={spec.examples} />
      </div>
    </article>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 1b. Known limitations — be honest with integrators

interface Limitation {
  status: 'soon' | 'planned' | 'wontfix'
  title: string
  detail: string
}

const LIMITATIONS: Limitation[] = [
  {
    status: 'planned',
    title: 'OpenAI Responses API (`/responses`)',
    detail:
      'The newer image+structured-output OpenAI endpoint that Doubao supports for `doubao-seed-2-0-lite` vision is not yet proxied — only `/chat/completions`. Track via the model card before relying on multimodal.',
  },
  {
    status: 'planned',
    title: 'Per-key rate limiting',
    detail:
      'No 429s today. Audit log shows the calls but nothing throttles a runaway client. Use upstream provider limits as the safety net for now.',
  },
  {
    status: 'wontfix',
    title: 'Write APIs (PATCH / DELETE on captures)',
    detail:
      'Captures are append-only by design (Pillar 2: event-sourced). Use soft-delete via the UI rather than expecting REST mutation surfaces.',
  },
]

function LimitationsSection() {
  return (
    <section>
      <SectionHeader
        title="KNOWN LIMITATIONS"
        hint="be honest with integrators"
      />
      <ul
        className="rounded-xl overflow-hidden"
        style={{
          border: '1px solid var(--line)',
          background: 'var(--panel)',
        }}
      >
        {LIMITATIONS.map((l, i) => (
          <li
            key={l.title}
            className="px-4 py-3 flex items-start gap-3"
            style={{
              borderTop: i === 0 ? 'none' : '1px solid var(--line)',
            }}
          >
            <StatusPip status={l.status} />
            <div className="min-w-0 flex-1">
              <div
                className="ts-13 mono"
                style={{ color: 'var(--hi)', fontWeight: 500 }}
              >
                {l.title}
              </div>
              <p
                className="ts-13 mt-0.5"
                style={{ color: 'var(--mute)', lineHeight: 1.55 }}
              >
                {l.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function StatusPip({ status }: { status: Limitation['status'] }) {
  const map = {
    soon: { color: 'var(--accent)', label: 'soon' },
    planned: { color: 'var(--warn)', label: 'planned' },
    wontfix: { color: 'var(--mute)', label: 'wontfix' },
  } as const
  const def = map[status]
  return (
    <span
      className="ts-12 mono whitespace-nowrap"
      style={{
        color: def.color,
        border: `1px solid ${def.color}`,
        padding: '2px 8px',
        borderRadius: 4,
        flexShrink: 0,
        minWidth: 64,
        textAlign: 'center',
      }}
    >
      {def.label}
    </span>
  )
}

function AuthBadge({ auth }: { auth: EndpointSpec['auth'] }) {
  if (auth === 'bearer-workspace-key') {
    return <span className="badge violet">workspace key</span>
  }
  return (
    <span
      className="badge"
      style={{
        color: 'var(--warn)',
        borderColor: 'oklch(0.7 0.14 75 / 0.4)',
        background: 'oklch(0.7 0.14 75 / 0.08)',
      }}
    >
      user session
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. API keys

function KeysSection({
  keys,
}: {
  keys: Awaited<ReturnType<typeof listApiKeysWithStatus>>
}) {
  return (
    <section>
      <SectionHeader
        title="API KEYS"
        hint={`${keys.filter((k) => k.isActive).length} active / ${keys.length} total`}
      />
      {keys.length === 0 ? (
        <EmptyKeys />
      ) : (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            border: '1px solid var(--line)',
            background: 'var(--panel)',
          }}
        >
          <div
            className="grid gap-3 px-4 py-2.5 ts-12 mono hairline-b"
            style={{
              gridTemplateColumns:
                '1.6fr 1.3fr 1.2fr 1.2fr 0.8fr',
              color: 'var(--mute2)',
              letterSpacing: '0.04em',
              background: 'var(--panel2)',
            }}
          >
            <span>NAME</span>
            <span>PREFIX</span>
            <span>CREATED</span>
            <span>LAST USED</span>
            <span>STATUS</span>
          </div>
          {keys.map((k) => (
            <div
              key={k.id}
              className="grid gap-3 px-4 py-3 ts-13 hairline-b"
              style={{
                gridTemplateColumns:
                  '1.6fr 1.3fr 1.2fr 1.2fr 0.8fr',
                color: 'var(--text)',
                alignItems: 'center',
              }}
            >
              <span
                className="truncate-1"
                style={{ color: 'var(--hi)' }}
                title={k.name}
              >
                {k.name}
              </span>
              <span className="mono" style={{ color: 'var(--mute)' }}>
                {k.prefix}…
              </span>
              <span className="mono ts-12" style={{ color: 'var(--mute)' }}>
                {new Date(k.createdAt).toLocaleString()}
              </span>
              <span className="mono ts-12" style={{ color: 'var(--mute)' }}>
                {k.lastUsedAt
                  ? new Date(k.lastUsedAt).toLocaleString()
                  : 'never'}
              </span>
              <span>
                {k.isActive ? (
                  <span className="badge green">active</span>
                ) : k.revokedAt ? (
                  <span
                    className="badge"
                    style={{
                      color: 'var(--mute)',
                      borderColor: 'var(--line2)',
                    }}
                  >
                    revoked
                  </span>
                ) : (
                  <span
                    className="badge"
                    style={{
                      color: 'var(--warn)',
                      borderColor: 'oklch(0.7 0.14 75 / 0.4)',
                      background: 'oklch(0.7 0.14 75 / 0.08)',
                    }}
                  >
                    expired
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <p
        className="mt-3 ts-12 mono"
        style={{ color: 'var(--mute2)' }}
      >
        mint a new key:{' '}
        <span style={{ color: 'var(--hi)' }}>npm run bootstrap</span>{' '}
        &nbsp;&middot;&nbsp; rotate all bootstrap keys:{' '}
        <span style={{ color: 'var(--hi)' }}>
          npm run bootstrap -- --rotate
        </span>
      </p>
    </section>
  )
}

function EmptyKeys() {
  return (
    <div
      className="text-center py-8 px-6 rounded-xl"
      style={{ border: '1px dashed var(--line2)', background: 'var(--panel)' }}
    >
      <p className="ts-13" style={{ color: 'var(--mute)' }}>
        No API keys yet. Run{' '}
        <span className="mono" style={{ color: 'var(--hi)' }}>
          npm run bootstrap
        </span>{' '}
        to mint one.
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Workspace usage summary

function UsageSection({
  usage,
}: {
  usage: Awaited<ReturnType<typeof getWorkspaceApiUsage>> | null
}) {
  if (!usage) return null
  return (
    <section>
      <SectionHeader title="LAST 7 DAYS" hint="across all keys" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <UsageTile label="calls" value={usage.last7dCalls} />
        <UsageTile
          label="errors"
          value={usage.last7dErrors}
          tone={usage.last7dErrors > 0 ? 'danger' : undefined}
        />
        <UsageTile
          label="p50"
          value={usage.p50DurationMs != null ? `${usage.p50DurationMs}ms` : '—'}
        />
        <UsageTile
          label="p95"
          value={usage.p95DurationMs != null ? `${usage.p95DurationMs}ms` : '—'}
        />
      </div>
      {usage.byEndpoint.length > 0 && (
        <div className="mt-4">
          <div
            className="ts-12 mono mb-2"
            style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
          >
            BY ENDPOINT
          </div>
          <ul
            className="rounded-xl overflow-hidden"
            style={{
              border: '1px solid var(--line)',
              background: 'var(--panel)',
            }}
          >
            {usage.byEndpoint.map((row) => (
              <li
                key={row.endpoint}
                className="flex items-center justify-between px-4 py-2.5 hairline-b ts-13"
              >
                <span className="mono truncate-1" style={{ color: 'var(--hi)' }}>
                  {row.endpoint}
                </span>
                <span className="mono" style={{ color: 'var(--mute)' }}>
                  {row.calls} call{row.calls === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function UsageTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone?: 'danger'
}) {
  return (
    <div
      className="p-4 rounded-xl"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div
        className="ts-12 mono mb-1.5"
        style={{ color: 'var(--mute2)', letterSpacing: '0.05em' }}
      >
        {label.toUpperCase()}
      </div>
      <div
        className="ts-24 mono"
        style={{ color: tone === 'danger' ? 'var(--danger)' : 'var(--hi)' }}
      >
        {value}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Recent calls

function RecentCallsSection({
  rows,
}: {
  rows: Array<typeof apiRequestLog.$inferSelect>
}) {
  return (
    <section>
      <SectionHeader title="RECENT CALLS" hint={`last ${rows.length}`} />
      {rows.length === 0 ? (
        <div
          className="text-center py-8 rounded-xl ts-13"
          style={{
            border: '1px dashed var(--line2)',
            background: 'var(--panel)',
            color: 'var(--mute)',
          }}
        >
          No requests logged yet.
        </div>
      ) : (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            border: '1px solid var(--line)',
            background: 'var(--panel)',
          }}
        >
          {rows.map((r) => (
            <div
              key={r.id}
              className="grid gap-3 px-4 py-2.5 ts-12 mono hairline-b"
              style={{
                gridTemplateColumns: '160px 60px 1fr 80px 90px',
                alignItems: 'center',
              }}
            >
              <span style={{ color: 'var(--mute)' }}>
                {new Date(r.ts).toLocaleString()}
              </span>
              <span
                style={{
                  color: r.status >= 400 ? 'var(--danger)' : 'var(--success)',
                  fontWeight: 500,
                }}
              >
                {r.status}
              </span>
              <span className="truncate-1" style={{ color: 'var(--hi)' }}>
                {r.method.replace(/^POST POST /, 'POST ').replace(/^GET GET /, 'GET ')}{' '}
                {r.endpoint.replace(/^(POST|GET) /, '')}
              </span>
              <span style={{ color: 'var(--mute2)' }}>
                {r.durationMs != null ? `${r.durationMs}ms` : '—'}
              </span>
              <span style={{ color: 'var(--mute2)' }}>
                {r.errorCode ?? ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// shared

function SectionHeader({
  title,
  hint,
}: {
  title: string
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <div className="lbl">§ {title}</div>
      {hint && (
        <span
          className="ts-12 mono"
          style={{ color: 'var(--mute2)' }}
        >
          {hint}
        </span>
      )}
    </div>
  )
}

function DbError({ message }: { message: string }) {
  return (
    <div
      className="p-6 rounded-xl"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div
        className="ts-13 mono mb-2"
        style={{ color: 'var(--danger)', letterSpacing: '0.05em' }}
      >
        § DATABASE NOT REACHABLE
      </div>
      <pre
        className="mt-2 ts-12 mono p-3 overflow-auto whitespace-pre-wrap"
        style={{
          background: 'var(--code-bg)',
          border: '1px solid var(--code-line)',
          color: 'var(--code-text)',
          borderRadius: 8,
        }}
      >
        {message}
      </pre>
    </div>
  )
}
