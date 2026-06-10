import type { Metadata } from 'next'
import Link from 'next/link'
import { listProviders } from '@/lib/proxy/provider-registry'

export const metadata: Metadata = {
  title: 'API & SDK — LabelHub',
}

/**
 * /docs — single-page reference for the public surface.
 *
 * Three sections, in order of "how a judge / publisher would explore":
 *
 *   1. Quickstart — one curl that captures a real trajectory
 *   2. Proxy API — the 6 providers + endpoint layout + headers
 *   3. SDK — copy-paste 120-line zero-dep client
 *
 * Server-rendered; no client interactivity. Doc strings + tested examples
 * only. If something's broken here, the README + this page break together.
 */
export default function DocsPage() {
  const providers = listProviders()
  return (
    <div className="docs-shell">
      <header className="docs-topnav">
        <Link href="/" className="docs-brand">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect
              x="0.5"
              y="0.5"
              width="17"
              height="17"
              rx="4"
              stroke="oklch(0.6 0.18 280)"
            />
            <path
              d="M5 4.5V13.5H13"
              stroke="oklch(0.6 0.18 280)"
              strokeWidth="1.5"
              strokeLinecap="square"
            />
          </svg>
          <span>LabelHub · docs</span>
        </Link>
        <nav className="flex items-center gap-5">
          <a href="#quickstart" className="docs-nav-link">
            Quickstart
          </a>
          <a href="#proxy" className="docs-nav-link">
            Proxy API
          </a>
          <a href="#guardrail" className="docs-nav-link">
            Guardrail
          </a>
          <a href="#sdk" className="docs-nav-link">
            SDK
          </a>
          <a href="#ingest" className="docs-nav-link">
            Ingest
          </a>
          <a href="#export" className="docs-nav-link">
            Export
          </a>
          <a href="#annotations" className="docs-nav-link">
            Annotations
          </a>
          <a href="#quality" className="docs-nav-link">
            Quality
          </a>
          <a href="#webhooks" className="docs-nav-link">
            Webhooks
          </a>
          <Link href="/" className="docs-nav-link">
            ← home
          </Link>
        </nav>
      </header>

      <main className="docs-main">
        <section className="docs-hero">
          <div className="docs-eyebrow">§ DOCS · v0</div>
          <h1 className="docs-h1">Build against LabelHub</h1>
          <p className="docs-lede">
            Two surfaces, one mental model: the <code>/api/proxy/*</code> family
            forwards your existing LLM calls and silently captures each
            trajectory; the SDK lets your own agent runtime push trajectories
            directly. Both produce the same canonical row in the database.
          </p>
        </section>

        <SectionAnchor id="quickstart" label="01" title="Quickstart" />
        <p className="docs-body">
          Get a workspace API key from{' '}
          <code>/workspaces/&lt;id&gt;/api</code> (or run{' '}
          <code>npm run bootstrap</code> locally). Then:
        </p>
        <CodeBlock
          lang="bash"
          code={`curl -sS -X POST https://aipert.top/api/proxy/doubao/chat/completions \\
  -H 'Authorization: Bearer lh_ws_YOUR_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "doubao-seed-2-0-lite-260428",
    "messages": [{ "role": "user", "content": "What is metformin?" }]
  }'`}
        />
        <p className="docs-body">
          The response is whatever Doubao would have sent you directly. In the
          background, LabelHub:
        </p>
        <ul className="docs-list">
          <li>
            authenticates your workspace key, hashes-only (
            <code>workspace_api_keys.key_hash</code>)
          </li>
          <li>
            resolves the upstream Doubao key from Supabase Vault (workspace-
            scoped, zero plaintext on disk)
          </li>
          <li>
            enforces RPM rate limit per connection (
            <code>provider_rate_log</code>)
          </li>
          <li>
            injects the workspace&apos;s Layer A topic-scope policy into the
            system prompt
          </li>
          <li>
            forwards verbatim; on 200, captures a canonical trajectory via
            <code> after()</code> so client latency is unaffected
          </li>
        </ul>
        <p className="docs-body">
          The captured trajectory is browsable at{' '}
          <code>/workspaces/&lt;id&gt;/trajectories</code> within seconds.
        </p>

        <SectionAnchor id="proxy" label="02" title="Proxy API" />
        <p className="docs-body">
          <code>POST /api/proxy/&lt;provider&gt;/&lt;path&gt;</code> — a
          catch-all that auto-dispatches to whichever provider you name.
          Adding a new provider is three lines in
          <code> src/lib/proxy/provider-registry.ts</code>.
        </p>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>kind</th>
                <th>family</th>
                <th>endpoint</th>
                <th>auth header</th>
                <th>env fallback</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.kind}>
                  <td>
                    <code>{p.kind}</code>
                  </td>
                  <td>
                    <span className={`family-${p.family.split('-')[0]}`}>
                      {p.family}
                    </span>
                  </td>
                  <td>
                    <code>
                      /api/proxy/{p.kind}/{p.upstreamPath.replace(/^\//, '')}
                    </code>
                  </td>
                  <td>
                    <code>
                      {p.apiHeader === 'authorization-bearer'
                        ? 'Authorization: Bearer'
                        : 'x-api-key'}
                    </code>
                  </td>
                  <td>
                    <code>{p.envFallback}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="docs-h3">Request body</h3>
        <p className="docs-body">
          Whatever the upstream provider expects, byte-for-byte. We do NOT
          transform your request — auth headers are swapped (your LabelHub
          key →the upstream key) and the topic-scope suffix is prepended to
          the system prompt; the model name, max_tokens, messages, tools, etc.
          are all forwarded as-is.
        </p>
        <h3 className="docs-h3">Streaming</h3>
        <p className="docs-body">
          Pass <code>stream: true</code> and the proxy proxies SSE byte-for-
          byte to the client (zero re-buffering). The trajectory capture runs
          off a tee&apos;d stream → reassembled in
          <code> openai-stream-adapter</code> / <code>anthropic-stream-adapter</code>{' '}
          → persisted via <code>after()</code> after the response is done.
        </p>
        <h3 className="docs-h3">Errors</h3>
        <p className="docs-body">
          Non-2xx upstream responses pass through verbatim. LabelHub-specific
          errors come back as <code>{'{ error: { message, code, type: \'labelhub_proxy\' }}'}</code>
          {' '}with a sensible status: 401 (no key), 429 (rate limited), 502
          (upstream down).
        </p>

        <SectionAnchor id="guardrail" label="03" title="Topic-scope guardrail" />
        <p className="docs-body">
          When a workspace has a topic scope configured (auto-generated from
          the primary task description, or admin-edited), every proxied call
          gets a non-negotiable platform-policy block prepended to its system
          prompt. Stops a leaked key from being repurposed as a generic
          ChatGPT.
        </p>
        <CodeBlock
          lang="bash"
          code={`# This call goes through but the model refuses because it's
# out-of-scope for the workspace's task. No extra latency.

curl -sS -X POST https://aipert.top/api/proxy/doubao/chat/completions \\
  -H 'Authorization: Bearer lh_ws_YOUR_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "doubao-seed-2-0-lite-260428",
    "messages": [{ "role": "user", "content": "Write me a poem about clouds." }]
  }'

# Expected response (verbatim from production):
# "I am only authorized to assist with medical fact-checking related
# tasks including drug interactions, common diagnoses, dosage calculations,
# citation quality, and patient-safety edge cases."`}
        />
        <p className="docs-body">
          Admins manage the scope at{' '}
          <code>/workspaces/&lt;id&gt;/api</code> — auto-regenerate from the
          task description or hand-edit the in-scope phrases, out-of-scope
          categories, and exact injected suffix.
        </p>

        <SectionAnchor id="sdk" label="04" title="SDK" />
        <p className="docs-body">
          If you can&apos;t use the proxy (e.g. your agent runs through a
          provider we don&apos;t support yet, or you&apos;re replaying
          historical traces), push trajectories directly. The SDK is a single
          120-line zero-dependency file you copy into your app.
        </p>
        <CodeBlock
          lang="typescript"
          code={`// src/sdk/labelhub-trace.ts  (or download from the repo)

import { trace } from '@labelhub/trace'  // or copy the file

const t = trace({
  apiKey: process.env.LABELHUB_KEY!,
  agentName: 'travel-bot',
  endpoint: 'https://aipert.top',
})

t.start({ rootPrompt: userQuery })
t.step({ kind: 'thinking', content: { text: 'Need to search flights first…' } })
t.step({
  kind: 'tool_call',
  content: { toolCallId: 'c1', toolName: 'search_flights', args: { origin: 'SFO' } },
})
t.step({
  kind: 'tool_result',
  content: { toolCallId: 'c1', output: { flights: [{ airline: 'JAL', price: 982 }] } },
})
t.step({ kind: 'final_response', content: { text: 'I recommend JAL for $982.' } })

await t.flush()  // POSTs the canonical trajectory to /api/ingest/trajectories`}
        />
        <p className="docs-body">
          Every step kind matches the canonical schema we capture from the
          proxy — see{' '}
          <code>src/lib/trajectories/schema.ts</code> for the full
          discriminated union. Step bodies are unconstrained jsonb so you can
          stash provider-specific metadata too.
        </p>

        <SectionAnchor id="ingest" label="05" title="Ingest (raw)" />
        <p className="docs-body">
          <code>POST /api/ingest/trajectories</code> — what the SDK calls
          under the hood. If you want to skip the SDK entirely, just POST
          your trajectory in one of three accepted formats:
        </p>
        <ul className="docs-list">
          <li>
            <code>X-LabelHub-Format: canonical</code> — our internal schema
            (the SDK&apos;s output)
          </li>
          <li>
            <code>X-LabelHub-Format: anthropic</code> — an Anthropic Messages
            API exchange
          </li>
          <li>
            <code>X-LabelHub-Format: openai-assistants</code> — an OpenAI
            Assistants API <code>run_steps</code> list
          </li>
        </ul>
        <p className="docs-body">
          Plus optional headers: <code>X-LabelHub-Agent-Name</code>,{' '}
          <code>X-LabelHub-Source</code> (one of{' '}
          <code>production / eval-run / synthetic / upload</code>).
        </p>

        <SectionAnchor id="export" label="06" title="Export" />
        <p className="docs-body">
          <code>GET /api/export/trajectories?workspaceId=…</code> — JSONL bulk
          dump of every trajectory + steps in a workspace, scoped to the API
          key&apos;s workspace. One trajectory per line, full canonical
          schema. Useful for re-importing into your own training pipeline or
          BigQuery.
        </p>
        <p className="docs-body">
          <code>GET /api/export/dataset?versionId=…&amp;format=teaching</code>
          {' '}— the teaching-signal export. Only items where an AI proposal
          existed, reshaped to{' '}
          <code>
            &#123; prompt, ai_proposal, human_correction, delta_summary,
            template_mode, source &#125;
          </code>
          . Drop straight into <code>trl/transformers</code> DPOTrainer or
          SFTTrainer with a one-line key remap — no transform step. Use{' '}
          <code>format=raw</code> (default) to get the full verbatim manifest
          instead.
        </p>

        <SectionAnchor id="annotations" label="07" title="Annotations" />
        <p className="docs-body">
          Pull the actual labeling output back into your pipeline. The
          response carries the canonical Mark shape (
          <code>&#123; scale, value, reason? &#125;</code>) — same one stored
          on disk, no lossy translation.
        </p>
        <CodeBlock
          lang="bash"
          code={`# Recent annotations across the workspace
curl -sS 'https://aipert.top/api/annotations?limit=10' \\
  -H 'Authorization: Bearer lh_ws_YOUR_KEY'

# Filter to one trajectory
curl -sS 'https://aipert.top/api/annotations?trajectory_id=<uuid>' \\
  -H 'Authorization: Bearer lh_ws_YOUR_KEY'

# Only fully-reviewed ones since a checkpoint
curl -sS 'https://aipert.top/api/annotations?status=approved&since=2026-05-01T00:00:00Z' \\
  -H 'Authorization: Bearer lh_ws_YOUR_KEY'`}
        />
        <p className="docs-body">
          Query params: <code>trajectory_id</code> · <code>status</code> (
          <code>drafting | submitted | approved | rejected | revising</code>) ·{' '}
          <code>since</code> · <code>until</code> · <code>limit</code> (≤200) ·{' '}
          <code>offset</code>.
        </p>
        <CodeBlock
          lang="json"
          code={`{
  "annotations": [
    {
      "id": "...",
      "trajectoryId": "...",
      "userId": "...",
      "userDisplayName": "Demo Admin",
      "status": "approved",
      "submittedAt": "2026-05-14T03:12:09.000Z",
      "reviewVerdict": "approved",
      "reviewFeedback": null,
      "reviewedAt": "2026-05-14T03:25:18.000Z",
      "trajectoryMarks": {
        "goal_achieved": { "scale": "likert", "value": 5, "reason": "..." }
      },
      "stepMarks": {
        "<stepId>": {
          "step_quality": { "scale": "likert", "value": 5, "reason": "..." },
          "safety":       { "scale": "bool",   "value": true }
        }
      }
    }
  ],
  "total": 87, "limit": 10, "offset": 0, "hasMore": true
}`}
        />
        <p className="docs-body">
          <code>GET /api/annotations/&lt;id&gt;</code> returns a single
          annotation in the same shape (wrapped in{' '}
          <code>&#123; annotation &#125;</code>). 404 for not-found OR
          wrong-workspace — we don&apos;t distinguish so tenant existence
          doesn&apos;t leak.
        </p>

        <SectionAnchor id="quality" label="08" title="Quality summary" />
        <p className="docs-body">
          Workspace-wide quality roll-up — one call, everything an external
          dashboard needs.
        </p>
        <CodeBlock
          lang="bash"
          code={`curl -sS 'https://aipert.top/api/quality/summary' \\
  -H 'Authorization: Bearer lh_ws_YOUR_KEY'`}
        />
        <CodeBlock
          lang="json"
          code={`{
  "workspaceId": "...",
  "asOf": "2026-05-14T10:23:45.000Z",
  "iaa": {
    "annotatedSteps": 57, "multiRaterSteps": 19,
    "disputedSteps": 4, "agreementRate": 0.7895
  },
  "raterCount": 3,
  "raters": [
    {
      "userId": "...", "displayName": "Demo Reviewer",
      "trust": { "source": "admin", "score": 0.7857, "positives": 4, "negatives": 1 },
      "calibration": { "matched": 5, "diverged": 2, "score": 0.625, "goldsCovered": 2 },
      "contribution": { "submitted": 5, "approved": 4, "rejected": 1, "pendingReview": 0 }
    }
  ],
  "goldStandards": { "count": 2, "items": [{ "id": "...", "trajectoryId": "...", "rubricCount": 4, ... }] },
  "criticalViolations": { "count": 2, "recent": [{ "trajectoryId": "...", "rubricName": "Safety", ... }] }
}`}
        />

        <SectionAnchor id="webhooks" label="09" title="Webhooks" />
        <p className="docs-body">
          Subscribe a URL to receive POSTs when annotations land. Each
          delivery is HMAC-signed with your subscription secret. Failures
          back off (10 strikes → auto-disable).
        </p>
        <CodeBlock
          lang="bash"
          code={`# Register a hook
curl -sS -X POST https://aipert.top/api/webhooks \\
  -H 'Authorization: Bearer lh_ws_YOUR_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "url": "https://your.app/incoming/labelhub",
    "events": ["annotation.approved", "annotation.rejected"]
  }'
# → { "webhook": { "id": "...", "secret": "<save this>", ... } }

# List your hooks
curl -sS https://aipert.top/api/webhooks \\
  -H 'Authorization: Bearer lh_ws_YOUR_KEY'

# Revoke
curl -sS -X DELETE https://aipert.top/api/webhooks/<id> \\
  -H 'Authorization: Bearer lh_ws_YOUR_KEY'`}
        />
        <p className="docs-body">
          Each delivery includes these headers:
        </p>
        <CodeBlock
          lang="http"
          code={`POST /incoming/labelhub HTTP/1.1
x-labelhub-event: annotation.approved
x-labelhub-signature: 5f3a... (hex hmac-sha256 of body, using your secret)
user-agent: LabelHub-Webhook/1.0
content-type: application/json

{ "type": "annotation.approved", "workspaceId": "...", "deliveredAt": "...",
  "payload": { "annotationId": "...", "submitterUserId": "...", "feedback": null } }`}
        />
        <p className="docs-body">
          Verify on your side:
        </p>
        <CodeBlock
          lang="ts"
          code={`import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(body: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signature, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}`}
        />
        <p className="docs-body">
          Currently emitted from the <code>reviewAnnotation</code> path
          (approved/rejected/revised). More event types and an in-app
          delivery log are next on the roadmap.
        </p>

        <footer className="docs-footer">
          <div className="docs-foot-line">
            <span style={{ color: 'oklch(0.55 0 0)' }}>
              Need something not listed?
            </span>{' '}
            <a
              href="https://github.com/nanshu1228-dot/labelhub"
              className="docs-foot-link"
              target="_blank"
              rel="noreferrer"
            >
              Open an issue ↗
            </a>
          </div>
        </footer>
      </main>
    </div>
  )
}

function SectionAnchor({
  id,
  label,
  title,
}: {
  id: string
  label: string
  title: string
}) {
  return (
    <div id={id} className="docs-section-anchor">
      <div className="docs-eyebrow">§ {label}</div>
      <h2 className="docs-h2">{title}</h2>
    </div>
  )
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="docs-code">
      <div className="docs-code-head">
        <span className="docs-code-lang">{lang}</span>
      </div>
      <pre className="docs-code-body">{code}</pre>
    </div>
  )
}
