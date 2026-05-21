# LabelHub

> **The Annotation-Aware LLM Gateway.**
> Drop in as your OpenAI / Anthropic `base_url`. Every agent call gets
> captured as a typed trajectory, scope-guarded against key abuse, and
> forkable from any step for counterfactual teaching — no SDK changes,
> no second pipeline.

**Live demo →** [`labelhub-gamma.vercel.app`](https://labelhub-gamma.vercel.app)

[![Tests](https://img.shields.io/badge/tests-748%20passing-brightgreen)]() [![Build](https://img.shields.io/badge/build-passing-brightgreen)]() [![Next.js](https://img.shields.io/badge/next-16.2.6-black)]() [![License](https://img.shields.io/badge/license-MIT-blue)]()

---

## Three things happen on every model call — zero code from you

1. **Auto-capture** — request flows through the proxy and lands as a typed
   trajectory: prompt, tool calls, tool results, latency, tokens, cost.
   OpenAI / Anthropic / Doubao / DeepSeek / Kimi / GLM, all six providers.
2. **Scope-inject** — each task auto-generates a policy prefix (“medical
   Q&A only”) that we inject into the system prompt before forwarding.
   A leaked key cannot be repurposed for off-task work.
3. **Teach-back** — every annotation captures the (AI proposal, human
   correction, delta) triplet alongside the rubric marks. One click →
   SFT / DPO-ready JSONL. Close the loop, do not just label.

Scale / Surge / Label Studio only annotate. LangSmith only observes.
LiteLLM only proxies. **LabelHub stitches all three around one signal:
the teaching delta between AI proposals and human corrections.**

## Three-line drop-in

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://labelhub-gamma.vercel.app/api/proxy/openai/v1",
    api_key="lh_demo_…",   # rate-limited public demo key
)
# every call below is captured + scope-injected automatically
client.chat.completions.create(model="gpt-4o-mini", messages=[…])
```

That's it. Open your workspace → trajectories appear in real time.

<details>
<summary><b>Try it from the terminal — verify the scope guardrail in 30 seconds</b></summary>

### 1. Browse the public demo workspace (no login needed)

→ [labelhub-gamma.vercel.app/workspaces/00000000-0000-0000-0000-000000000010](https://labelhub-gamma.vercel.app/workspaces/00000000-0000-0000-0000-000000000010)

Pre-seeded with 3 raters, 5 trajectories (~17 steps each), real IAA
disputes, and a topic scope locked to "medical fact-checking". Try the
annotator on any trajectory — `/trajectories/<id>/annotate`. Keyboard
shortcuts: `j` / `k` to move, `1` / `3` / `5` to rate, `?` for the
rubric reference drawer.

### 2. Verify the topic-scope guardrail (one curl)

First, grab the live rate-limited public demo key (rotated regularly):

```bash
export LABELHUB_DEMO_KEY=$(curl -s https://labelhub-gamma.vercel.app/api/demo/info | jq -r .demoKey)
```

The demo key is capped at 10 requests/min and scoped to the medical-
fact-checking workspace only. Now try asking for a poem — the topic-
scope guardrail will refuse:

```bash
curl -sS -X POST https://labelhub-gamma.vercel.app/api/proxy/doubao/chat/completions \
  -H 'Authorization: Bearer $LABELHUB_DEMO_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"model":"doubao-seed-2-0-lite-260428",
       "messages":[{"role":"user","content":"Write me a 4-stanza poem about clouds."}],
       "max_tokens":300}' \
  | jq -r '.choices[0].message.content'
```

Expected response (verbatim from the live demo):

> *"I am only authorized to assist with medical fact-checking related tasks
> including drug interactions, common diagnoses, dosage calculations,
> citation quality, and patient-safety edge cases…"*

The model self-classified the request as out-of-scope. **No extra API
call, no classifier, no latency hit** — just a system-prompt prefix
generated once by Haiku and cached in the DB.

Now ask a medical question through the same key and see it answer normally:

```bash
curl -sS -X POST https://labelhub-gamma.vercel.app/api/proxy/doubao/chat/completions \
  -H 'Authorization: Bearer $LABELHUB_DEMO_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"model":"doubao-seed-2-0-lite-260428",
       "messages":[{"role":"user","content":"What are common side effects of metformin?"}],
       "max_tokens":300}' \
  | jq -r '.choices[0].message.content'
```

### 3. Watch a trajectory get captured

Every successful call through the proxy is captured asynchronously
(via Next 16's `after()` API — zero latency penalty for the caller).
After running step 2 above, refresh the workspace's
[trajectories list](https://labelhub-gamma.vercel.app/workspaces/00000000-0000-0000-0000-000000000010/trajectories) —
your call appears with the full reasoning trace, both turns side by
side.

</details>

## Finals build (spec 4.1 – 4.6)

The prelims thesis ("Annotation-Aware LLM Gateway") stays the
differentiator. Finals adds the missing platform layers so the
gateway has somewhere to land the captured signal.

| Spec section | Surface | File pointer |
|---|---|---|
| **4.1 任务导入** (multi-format) | `/admin/tasks/[id]/import` + parser registry for JSON / JSONL / CSV / Excel; 3 distribution strategies | `src/lib/import/parsers/*` · `src/lib/import/distribution.ts` |
| **4.2 动态表单 Designer** ⭐⭐⭐ | `/admin/forms/*` 11-material drag-drop canvas; JSON-Schema-draft-07 serializer; field linkage + custom validation; group + tab-layout containers; Designer/Renderer ESLint-decoupled | `src/components/form-designer/*` · `src/components/form-materials/*` · `src/components/form-renderer/*` · `src/lib/form-designer/*` |
| **4.3 Labeler workbench** | `/my/queue` + per-field 🪄 AI assist on `llm-trigger` material; keyboard nav (J/K, arrows); loading skeleton; mobile-responsive | `src/app/api/llm-assist/*` · `src/components/form-materials/llm-trigger-field.tsx` · `src/components/labeler/use-prev-next-nav.ts` |
| **4.4 AI 审核 Agent** ⭐⭐⭐ | Per-submission auto-trigger via `after()`; Function Calling structured verdict (`pass`/`send_back`/`human_review`); idempotency + retry + quota gate; owner config UI; verdict routes topic state | `src/lib/actions/ai-review-submission.ts` · `src/lib/ai/review-agent.ts` · `src/app/workspaces/[id]/tasks/[taskId]/ai-agent/*` · [`docs/AI_AGENT.md`](docs/AI_AGENT.md) |
| **4.5 审核工作流** | `/review` queue (cross-workspace, AI-priority sort); `/review/[id]` single view with diff + verdict panel; batch approve / send-back; formal state machine; audit timeline with AI events | `src/app/review/*` · `src/components/review/*` · `src/lib/quality/state-machine.ts` · `src/lib/actions/review-batch.ts` |
| **4.6 多格式导出** | `/api/export/dataset?encoding=json|jsonl|csv|excel`; formatter registry mirrors the import parsers; field mapping config | `src/lib/export/formatters/*` · `src/app/api/export/dataset/*` |

**State machine (D12)**: 19 documented transitions, 4 actors (annotator / ai / qc / admin), idempotency-on-terminal-only. `src/lib/quality/state-machine.ts` is the canonical authority; illegal moves throw `IllegalTransitionError`. Lifecycle:

```
drafting ─submit→ ai_review ─ai_pass→ reviewing ─qc_pass→ awaiting_acceptance ─admin_accept→ approved
                          └ai_send_back→ drafting (with ai_send_back revision)
                          └ai_human_review→ reviewing (priority flag)
                          └ai_fail→ submitted (human takeover)
```

**Test inventory**: 748 unit + integration tests across 50 files. Coverage focus areas:
- Designer ↔ JSON Schema round-trip (24 tests)
- State-machine matrix (44 tests, legal / illegal / idempotent / role-gated)
- AI Review Agent: function calling + retry + verdict routing + notification fan-out (37 tests)
- Multi-format parsers + formatters (71 tests; round-trips parser ↔ formatter)
- Review batch ops + queue isolation (18 tests)

**3-minute quickstart for judges:**
1. Open the Designer at `https://labelhub-gamma.vercel.app/admin/forms/new`. Drag 4-5 widgets onto the canvas; the right-pane property editors tune each one. Save.
2. The saved schema is selectable when creating a `custom-designer` task at `/workspaces/[id]/tasks/new` — assign topics via the importer at `/admin/tasks/[id]/import` (paste JSONL or upload .xlsx).
3. Switch to a Labeler account at `/my/queue`. Click a topic → the Renderer hydrates the schema. Click 🪄 to invoke the AI assist; submit when done.
4. Submit fires the AI Review Agent in Vercel's `after()` window. Refresh `/review` to see the verdict + priority sort.
5. As QC, approve or send-back via the queue's batch bar OR the single-annotation view at `/review/[id]`.
6. Audit timeline on the review page shows `ai_review.started → ai_review.completed`-or-`sent_back → qc_passed` lineage.
7. Export the result as Excel via `/api/export/dataset?versionId=…&encoding=excel`.

Deeper reading:
- [`docs/AI_AGENT.md`](docs/AI_AGENT.md) — AI Review Agent lifecycle + Function Calling + retry semantics + idempotency
- [`docs/API.md`](docs/API.md) — every HTTP endpoint + auth gate + error code
- [`docs/ROLE_PERMISSIONS.md`](docs/ROLE_PERMISSIONS.md) — role × action matrix incl. all finals surfaces
- [`docs/finals-plan.md`](docs/finals-plan.md) — 20-day execution plan + risk matrix + cut list

## Architecture

### Five pillars (from `AGENTS.md`)

1. **Local-First** — writes hit IndexedDB first (Dexie), sync to server async
2. **Event-Sourced** — append-only `events` table; state is a projection
3. **Optimistic locking** — `version` columns on hot tables (not CRDT)
4. **Schema-driven templates** — annotation modes are declarative configs
   with a `PerfBudget` the registry enforces statically
5. **Resource-aware** — virtualized lists past 30 rows; `next/image` for media

### Hero feature pipeline

```
Publisher API call
  │
  ▼
/api/proxy/{kind}/{...path}             ← 6 providers, 2 families
  │
  ├─ authenticateApiKey()                 (SHA-256 hashed keys)
  ├─ rateLimit(connection, rpm)
  ├─ resolveTopicScope(workspace)         ← Layer A guardrail
  ├─ injectScopeForFamily(body, suffix)   ← system-prompt prefix
  ├─ fetch(upstream, injectedBody)
  └─ after(persistTrajectory)             ← non-blocking capture
                                              ▼
                                     trajectory + steps + tool_providers
                                              ▼
                                     /workspaces/[id]/trajectories/[id]/annotate
                                       ├─ TanStack-virtualized step list
                                       ├─ Jotai atomFamily per (step, rubric)
                                       ├─ blur-only autosave (no keystroke writes)
                                       └─ Claude pre-annotations + peer marks
```

### Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) | Server Actions, `after()` API, async cookies |
| Database | Postgres (Supabase) | Vault for encrypted secrets; any provider via `DATABASE_URL` |
| ORM | Drizzle | Type-safe, parameterized, provider-agnostic |
| Auth | Supabase Auth (`@supabase/ssr`) | Cookie-based; provider-agnostic via swap of 3 files |
| Storage | Supabase Storage | Content-addressable (hash + size); range-request safe |
| AI | Anthropic Claude (Haiku-4.5, Sonnet-4.6, Opus-4.7) | Tool use, prompt caching; daily quota tracking |
| Client state | Jotai (`atomFamily`) + TanStack Query | Atomic per-row state for editable grids |
| Virtualization | `@tanstack/react-virtual` | Mandatory past 30 rows (perfBudget rule) |
| Local DB | Dexie (IndexedDB) | Local-first, offline-safe queue |
| Tests | Vitest | **189 tests passing** |
| Validation | Zod | Every Server Action input + every external payload |

### Repository map

```
src/
  app/
    page.tsx                            ← landing
    signin/, signup/, signout/          ← auth flow (Supabase password)
    workspaces/
      new/                              ← template picker (auth-gated)
      [id]/
        page.tsx                        ← dashboard
        api/                            ← API key management
        connections/                    ← provider connections (Vault-encrypted)
        disputes/                       ← IAA disputes + AI patch suggestions
        eval-runs/new/
        trajectories/
          page.tsx                      ← list (search + filter + virtualized)
          [trajId]/
            page.tsx                    ← read-only inspector
            annotate/page.tsx           ← interactive annotator (Jotai-powered)
    api/
      proxy/[kind]/[...path]/route.ts   ← 6-provider catch-all + capture + guardrail
      ingest/trajectories/              ← SDK ingest channel
      export/trajectories/              ← JSONL bulk download
      trajectories/                     ← list + read REST
      eval-runs/                        ← simulated-tool eval

  components/
    trajectory/annotate/                ← Jotai-powered annotator (Standard/Focus/Compare)
    auth/                               ← signin/signup form
    site/                               ← landing surfaces

  lib/
    actions/                            ← Server Actions (auth, marks, scope, etc.)
    queries/                            ← read-side data accessors
    ai/
      anthropic.ts                      ← shared Claude client
      topic-scope.ts                    ← scope generator (Haiku → JSON envelope)
      trajectory-reviewer.ts            ← per-step Claude pre-annotation
      guideline-refiner.ts              ← turns disputes into guideline patches
      spec-generator.ts                 ← "30-second task spec" hero feature
    proxy/
      provider-registry.ts              ← single source of truth for 6 providers
      inject-scope.ts                   ← system-prompt suffix injector (15 tests)
      sse-tee.ts                        ← streaming tee + accumulator
      persist-with-storage.ts           ← async capture via after()
    templates/
      rubric.ts                         ← RubricSpec / RubricItem / Mark types (21 tests)
      registry.ts                       ← perfBudget validator (rejects unsafe configs)
      modes/agent-trace-eval.ts         ← flagship template with full rubric
    db/schema.ts                        ← 20 tables + relations
    events/                             ← Pillar 2 event types + projector

drizzle/                                ← generated migrations
scripts/                                ← seed + bootstrap
AGENTS.md                               ← rules for AI coding agents (read first)
```

## Quick start (local dev)

```bash
git clone https://github.com/nanshu1228-dot/labelhub
cd labelhub
npm install
cp .env.example .env.local              # then fill in 5 values
npx tsx scripts/bootstrap-demo.ts       # mints demo workspace + API key
npm run dev                             # http://localhost:3000
```

Required env:

```
DATABASE_URL=postgres://...
NEXT_PUBLIC_SUPABASE_URL=https://....supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...
SUPABASE_SERVICE_ROLE_KEY=eyJh...
ANTHROPIC_API_KEY=sk-ant-...
LABELHUB_DEMO_MODE=true                 # opens demo-only Server Actions
```

Then:

1. Visit `/signup` and create a real account (email + password OR Google), or
2. Go straight to `/workspaces/00000000-0000-0000-0000-000000000010` to
   tour the bootstrapped demo (read-only without sign-in, full-edit
   with the demo mode env above).

## Enabling Google sign-in

The button is on `/signin` and `/signup` already — flip it on by configuring
the provider once in two consoles. Total time: ~10 minutes.

### Google Cloud Console

1. [console.cloud.google.com](https://console.cloud.google.com/) →
   create or pick a project
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**
3. Application type: **Web application**
4. Authorized redirect URIs (add BOTH):
   ```
   https://<your-supabase-project>.supabase.co/auth/v1/callback
   http://localhost:3000/auth/callback        ← for local dev
   ```
5. Copy the **Client ID** + **Client secret**

### Supabase Dashboard

1. **Project Settings → Authentication → Providers → Google → Enable**
2. Paste the Client ID + Client secret from step 5 above
3. **Authentication → URL Configuration → Site URL**: your prod URL
4. **Redirect URLs**: add `https://your-prod-url.com/auth/callback` and
   `http://localhost:3000/auth/callback`

Save. The "Continue with Google" button now works end-to-end — Supabase
handles the OAuth code exchange, our `/auth/callback` route picks up the
session and mirrors the user into `public.users`.

No code changes needed. The button is dark-aware and shows a useful error
message when the provider isn't configured yet (Supabase returns
`provider_not_enabled` which lands in `?oauth_error=...`).

## Scripts

```bash
npm run dev            # dev server on :3000 (Turbopack default)
npm run build          # production build (typecheck + bundle)
npm run start          # serve built app
npm test               # vitest run (189 tests)
npm run db:generate    # generate migration from schema diff
npm run db:push        # apply schema directly to DB
```

## Adding a new LLM provider

3 lines in `src/lib/proxy/provider-registry.ts` — the catch-all route
auto-exposes it at `/api/proxy/<kind>/...`, the connection-management UI
auto-lists it, capture works for free if it speaks openai-compat or
anthropic.

## Adding a new annotation paradigm

1. Write `src/lib/templates/modes/<name>.ts` declaring `itemSchema`,
   `responseSchema`, `rubric`, `perfBudget`.
2. Add the side-effect import in `src/lib/templates/init.ts`.
3. The registry validates the `perfBudget` at registration time and
   refuses anything that would jank past 50 rows.

The annotator UI consumes `template.rubric` and produces the correct
inputs (likert / bool / enum / text) automatically — no React code
change needed for a new template mode.

## Security

See `project_security_model.md` (in `~/.claude/projects/D--Challenge/memory/`
for the local dev) for the 14-point control list. Highlights:

- API keys SHA-256-hashed at rest; prefix-only display
- Provider keys encrypted via Supabase Vault (pgsodium) — never in plaintext
- Workspace API keys gate every `/api/proxy/*` call; per-connection RPM limit
- Every mutation = Zod parse → guard → DB write → event emit
- AI prompts wrap user content in XML tags (prompt-injection defense)
- Topic-scope policy injection on every proxied request (this README's curl demo)
- `server-only` import on every module that touches secrets

## License

MIT.
