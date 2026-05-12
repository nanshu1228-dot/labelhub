# LabelHub

> **Capture the teaching, not just the label.** An AI-native annotation platform built for the LLM-agent era — the flagship mode lets publishers paste an agent config and watch trajectories stream in, fully annotated by Claude pre-review.

[![Build](https://img.shields.io/badge/build-passing-brightgreen)]() [![Tests](https://img.shields.io/badge/tests-56%20passing-brightgreen)]() [![Next.js](https://img.shields.io/badge/next-16.2.6-black)]() [![License](https://img.shields.io/badge/license-MIT-blue)]()

---

## Why LabelHub

Existing annotation platforms (Surge, Scale, Label Studio, ByteDance Xpert) are built around static prompt-response pairs. They cannot handle **agent trajectories** — the multi-step tool-use sequences that define modern LLM applications.

LabelHub is built for the new shape of work:

| Existing platforms | LabelHub |
|---|---|
| Annotate one prompt + one response | Evaluate full agent trajectories (tool calls, reasoning, branches) |
| One annotation paradigm per platform | **One engine, 7 template modes** (the "Annotation OS") |
| Static rubrics | **Live AI co-annotation** + self-evolving guidelines |
| Per-call labels only | **Teaching signal** = capture human-vs-AI delta on every step |
| Closed marketplaces | Open API + SDK for production ingest |

## Status

| Layer | State |
|---|---|
| Backend | ✅ Complete · 17 tables · 8 routes · ~6500 LOC · 56 tests passing |
| Auth + guards + audit | ✅ Complete · workspace API keys · SHA-256 hashed · per-call audit log |
| Trajectory pipeline | ✅ Complete · 3 adapters · auto-inferred tool providers · soft-delete · bulk JSONL export |
| AI helpers | ✅ Complete · Spec Generator · Pair Suggester · **Trajectory Reviewer** |
| API management | ✅ Complete · per-key usage · workspace aggregates · request log |
| Data management | ✅ Complete · search/filter · soft-delete · export · storage stats |
| UI | 🟡 In progress · Landing + workspace picker shipped · rest goes through Claude Design |
| Production deploy | 🟡 Pending · awaiting sponsor infrastructure |

## Quick start

```bash
git clone <repo>
cd labelhub
npm install
cp .env.example .env.local   # then fill in 5 values
npm run db:push              # push 17 tables to Supabase
npm run seed                 # generate demo data
npm run dev                  # localhost:3000
```

**First time?** Follow [`SETUP.md`](./SETUP.md) — full 30-min walkthrough.

## Architecture

### Five Pillars

1. **Local-First** — every write hits IndexedDB first, sync to server async
2. **Event-Sourced** — append-only `events` table; state derives from projections
3. **Optimistic Locking** — `version` columns on hot tables, no CRDT bloat
4. **Schema-Driven Templates** — annotation paradigms are declarative configs with enforced PerfBudget
5. **Resource-Aware Assets** — virtualized lists past 30 rows; `next/image` for media

See [`INFRASTRUCTURE.md`](./INFRASTRUCTURE.md) for provider portability + migration recipes.

### Hero feature: Eval-Run

```
Publisher → POST /api/eval-runs
              { agent: { systemPrompt, tools }, inputs: ["...", "..."] }
                                              ▼
                Claude runs the agent loop with SIMULATED tools
                                              ▼
                Canonical trajectories persisted + topics auto-created
                                              ▼
                Annotators claim → AI pre-review each step → submit
                                              ▼
                "Watch Your Model Learn" curve climbs in real time
```

**Zero publisher infrastructure required** — tools are simulated by a Haiku-4.5 sub-prompt, never call publisher endpoints.

### Three ingest channels, one canonical schema

```
  Eval-Run endpoint   →    persistTrajectory()    ← SDK + REST ingest
  (managed, demo)            ▲                    (production)
                             │
                       Upload JSON
                       (historical)
```

All three flow through the same adapter layer + canonical schema.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Server Actions, async cookies, Turbopack default |
| DB | Postgres (Supabase by default) | Any provider via `DATABASE_URL` |
| ORM | Drizzle | Type-safe, parameterized, provider-agnostic |
| Auth | Supabase Auth | Cookies-friendly; swappable via 3 files (see INFRASTRUCTURE.md) |
| AI | Anthropic Claude (Sonnet 4.6 / Haiku 4.5) | Tool use, prompt caching; swappable to OpenAI/Gemini |
| State (client) | Jotai · TanStack Query | Atomic state for perf-critical lists |
| Local DB (client) | Dexie | Local-first + offline-safe writes |
| Test | Vitest | Pure-function unit tests; 56 passing |
| Type validation | Zod | Every Server Action input + every external payload |

## Folder map

```
labelhub/
├── src/
│   ├── app/                        # Next.js App Router (pages + API routes)
│   ├── components/                 # React components (some from Claude Design)
│   ├── lib/
│   │   ├── actions/                # Server Actions (mutations)
│   │   ├── queries/                # Read-side data accessors
│   │   ├── ai/                     # Claude wrappers (spec-gen, pair, trajectory-review)
│   │   ├── auth/                   # guards + api-key + provider interface
│   │   ├── db/                     # Drizzle schema + lazy client
│   │   ├── events/                 # event types + projections (Pillar 2)
│   │   ├── trajectories/           # canonical schema + adapters + ingest
│   │   ├── templates/              # 7 modes + registry + perfBudget validator
│   │   ├── supabase/               # Auth client (swappable provider)
│   │   ├── api/                    # request audit logger
│   │   └── env.ts                  # type-safe env access
│   └── sdk/labelhub-trace.ts       # 120-line zero-dep client SDK
├── scripts/seed-demo.ts            # `npm run seed` — idempotent demo data
├── drizzle/                        # generated migrations
├── proxy.ts                        # Next 16 renamed middleware (session refresh)
├── vitest.config.ts                # test runner config
├── SETUP.md                        # 30-min setup walkthrough
├── INFRASTRUCTURE.md               # portability + migration recipes
├── AGENTS.md                       # rules for AI coding agents
└── CLAUDE.md                       # imports AGENTS.md
```

## Routes

| Path | Method | Purpose |
|---|---|---|
| `/` | GET | Landing page |
| `/workspaces/new` | GET | Template picker |
| `/workspaces/[id]` | GET | Workspace dashboard |
| `/api/eval-runs` | POST | **Hero**: run agent with simulated tools |
| `/api/ingest/trajectories` | POST | SDK production ingest (API key auth) |
| `/api/export/trajectories` | GET | JSONL bulk download (admin only) |

## Memory docs (architectural decisions)

This project preserves design decisions across AI sessions:

- `project_labelhub.md` — top-level scope + thesis
- `project_security_model.md` — 14-point security controls
- `project_trajectory_architecture.md` — flagship pillar design
- `project_perf_requirements.md` — virtualization + atomic state mandates
- `project_nextjs16_quirks.md` — async params + proxy + Turbopack notes
- `project_design_brief.md` — Linear × Anthropic × Vercel aesthetic
- `feedback_innovation_over_copy.md` — don't reverse-engineer competitors

## Scripts

```bash
npm run dev            # dev server on :3000 (Turbopack default)
npm run build          # production build
npm run start          # start built app
npm run lint           # ESLint
npm test               # vitest run (56 tests)
npm run test:watch     # vitest watch
npm run db:generate    # generate migration from schema diff
npm run db:push        # apply schema directly to DB
npm run db:studio      # open Drizzle Studio
npm run seed           # populate demo data (requires DATABASE_URL)
```

## Contributing / extending

When adding features, the project rules in `AGENTS.md` matter:

1. **Read `node_modules/next/dist/docs/`** before writing Next.js code — Next 16 has breaking changes from training data
2. **Every mutation = Zod parse → guard → DB write → emit event**
3. **Lists past 30 rows = virtualization mandatory** (perfBudget enforces)
4. **AI prompts wrap user content in XML tags** (prompt-injection defense)
5. **Server-only modules import `'server-only'`** — keeps secrets out of client bundles

## License

MIT
