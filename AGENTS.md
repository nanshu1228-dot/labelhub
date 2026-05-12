<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## LabelHub — agent quick reference

### Project elevator pitch
LabelHub is an **AI-native, self-evolving annotation platform for the LLM era**. It captures the *teaching signal* (delta between AI proposals and human corrections), not just labels. One engine powers many template modes (classic survey, pair annotation, arena battle, token economy, etc.).

### Five architectural pillars
1. **Local-First** — all writes hit IndexedDB first (`src/lib/local-store`), then sync. Survives offline.
2. **Event-Sourced** — append-only events (`src/lib/events`); state = projection over events. Powers time-travel + audit.
3. **Optimistic locking** (NOT CRDT) — multi-user realtime is out of scope; use row-level versioning.
4. **Schema-Driven Templates** — every annotation paradigm is a `PlatformTemplate` in `src/lib/templates/registry.ts`. Templates declare a `PerfBudget` the registry enforces statically.
5. **Resource-Aware Assets** — images/PDFs via `next/image` + range requests; lists past 30 rows MUST virtualize.

### Hard perf rules (learned from prior platforms that died at 50 rubrics)
- Annotation grids: `@tanstack/react-virtual` mandatory past 30 rows.
- Row state: Jotai `atomFamily` keyed by row ID — NEVER lift to parent for editable lists past 50 rows.
- Text inputs in lists: uncontrolled refs; autosave on blur/debounce, **never on keystroke**.
- Memoize markdown render output per row (LRU).

### Stack lock-ins
- Next.js 16 (App Router, Turbopack default). `params`/`searchParams`/`cookies()`/`headers()` are `Promise<>` — always `await`.
- Drizzle ORM + `postgres` (postgres-js) → Supabase Postgres URL.
- Supabase Auth via `@supabase/ssr`.
- Jotai (client state) + TanStack Query (server-state sync) + Dexie (local store).
- Server Actions for mutations; Route Handlers for streaming / external APIs.
- Anthropic Claude (`src/lib/ai/anthropic.ts`): Haiku-4.5 (fast), Sonnet-4.6 (default), Opus-4.7 (premium).
- Tailwind v4 + shadcn/ui (neutral palette).

### Folder map
```
src/
  app/                # Next router (pages, layouts, API routes)
  components/
    ui/               # shadcn primitives — DO NOT hand-edit; use `npx shadcn@latest add <name>`
  lib/
    db/               # Drizzle schema + client (server-only)
    events/           # Event types + projector (Pillar 2)
    local-store/      # Dexie IndexedDB (Pillar 1, browser-only)
    templates/        # Template engine (Pillar 4) — strategic file
    ai/               # Claude API wrapper (server-only)
    utils.ts          # shadcn-generated cn()
drizzle/              # Drizzle migrations (generated)
drizzle.config.ts     # Drizzle CLI config
.env.example          # Copy to .env.local before working
```

### When adding a feature, ask:
1. Which pillar does this live under? If none, the feature is wrong.
2. Does it write data? Then route through Local-First (Pillar 1) + emit an Event (Pillar 2).
3. Does it render an editable list past 30 rows? Then virtualize + atomic state (Pillar 4's perf budget).
4. Is the change UI-paradigm-level (e.g. "make it look like LMSYS arena")? Then it's a new template mode, not custom code.
