# LabelHub

> **Capture the teaching, not just the label.**
> An AI-native annotation platform for the LLM-agent era.

**Live demo →** [`labelhub-gamma.vercel.app`](https://labelhub-gamma.vercel.app)

[![Tests](https://img.shields.io/badge/tests-189%20passing-brightgreen)]() [![Build](https://img.shields.io/badge/build-passing-brightgreen)]() [![Next.js](https://img.shields.io/badge/next-16.2.6-black)]() [![License](https://img.shields.io/badge/license-MIT-blue)]()

---

## What it does in 30 seconds

A publisher pastes an agent config. LabelHub proxies their LLM API key,
**captures every trajectory** (thinking → tool calls → tool results → final
response), generates a Claude pre-annotation, and lets a human grade each
step with a 4-input rubric (likert / bool / enum / text). The delta between
Claude's pre-annotation and the human's final mark *is* the teaching signal.

Three things this does that Surge / Scale / Label Studio don't:

1. **Trace-shaped annotation** — annotate 500-step agent traces, not just
   prompt/response pairs. Standard / Focus / Compare layouts; virtualized;
   atomic Jotai state per (step, rubric) so the rubric grid stays smooth
   at 1000+ rows.
2. **Auto topic-scope guardrail** — a Haiku-generated policy is auto-injected
   into the system prompt of every proxied request. A leaked API key
   can't be repurposed as a free general ChatGPT. Live demo below.
3. **Self-evolving guidelines** — disputed marks feed an AI Guideline
   Refiner that proposes patches; admins accept/reject; the version
   counter on `guidelines` lets us plot *"agreement rate climbing as
   guidelines mature."* This is the hero metric.

## See it work — 60 seconds

### 1. Browse the public demo workspace (no login needed)

→ [labelhub-gamma.vercel.app/workspaces/00000000-0000-0000-0000-000000000010](https://labelhub-gamma.vercel.app/workspaces/00000000-0000-0000-0000-000000000010)

Pre-seeded with 3 raters, 5 trajectories (~17 steps each), real IAA
disputes, and a topic scope locked to "medical fact-checking". Try the
annotator on any trajectory — `/trajectories/<id>/annotate`. Keyboard
shortcuts: `j` / `k` to move, `1` / `3` / `5` to rate, `?` for the
rubric reference drawer.

### 2. Verify the topic-scope guardrail (one curl)

The demo workspace has an API key already minted. The scope is locked
to medical topics — try asking for a poem:

```bash
curl -sS -X POST https://labelhub-gamma.vercel.app/api/proxy/doubao/chat/completions \
  -H 'Authorization: Bearer lh_ws_7fTnxnfKRZ7yP2BrOCD2W8E14GIQ6cFf-TgvU5pwTNQ' \
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
  -H 'Authorization: Bearer lh_ws_7fTnxnfKRZ7yP2BrOCD2W8E14GIQ6cFf-TgvU5pwTNQ' \
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

1. Visit `/signup` and create a real account, or
2. Go straight to `/workspaces/00000000-0000-0000-0000-000000000010` to
   tour the bootstrapped demo (read-only without sign-in, full-edit
   with the demo mode env above).

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
