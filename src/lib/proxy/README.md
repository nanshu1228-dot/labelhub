# `lib/proxy` — Gateway sub-package (LLM proxy)

> **Boundary:** this is part of the **gateway** half of LabelHub (see the
> repo-root `ARCHITECTURE.md` §1), not the annotation core. Annotation-core
> code should **not** import this package's internals. Treat it as a bounded
> sub-system with a single public entry.

## What it is

The drop-in OpenAI/Anthropic-compatible proxy: a workspace points its agent
at `/api/proxy/{provider}/*` with a workspace API key, and every upstream
LLM call is authenticated, scope-guarded, streamed back verbatim, and
captured as a trajectory.

## Request lifecycle (the one public path)

```
POST /api/proxy/[kind]/[...path]/route.ts   ← the only public entry
   → provider-registry.ts        resolve provider + base URL
   → connections / vault         resolve the upstream credential
   → ratelimit                   per-workspace rate guard
   → openai/anthropic adapters   translate request/response shapes
   → sse-tee.ts                  stream to caller AND fork a copy
   → persist-with-storage.ts     write the captured trajectory + steps
```

The 500-line route delegates well — keep it that way. New annotation
features must not reach in here; if you need proxy behavior, go through the
route/SSE boundary.

See also: `lib/trajectories` (what the captured copy becomes).
