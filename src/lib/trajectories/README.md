# `lib/trajectories` — Gateway sub-package (agent-trace capture)

> **Boundary:** part of the **gateway** half of LabelHub (see repo-root
> `ARCHITECTURE.md` §1). Annotation-core code should not depend on these
> internals; the schema tables live in `db/schema/trajectories.ts`.

## What it is

Parsing, normalization, and adapters for captured agent **trajectories** —
the tool-call / reasoning / result steps an agent emits, stored as
`trajectories` + `trajectorySteps` and annotated per-step in the
`agent-trace-eval` template mode.

## Shape

- `schema.ts` / `adapters.ts` — the canonical trajectory + step shape and
  the provider-specific adapters that produce it (fed by `lib/proxy`'s
  capture path and the `/api/ingest/trajectories` route).
- Feature/summary backfills live in `scripts/backfill-trajectory-*.ts`.

This sub-system is only exercised by `agent-trace-eval` workspaces, which
**focus mode** hides by default (see `ARCHITECTURE.md` §5).
