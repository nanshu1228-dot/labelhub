# AI-Coding Process Record

How LabelHub was built and hardened with an AI coding agent. This is the
honest methodology + the actual sequence of work — not a marketing doc. The
point a judge should take away: the AI was used as an **orchestrator running
deterministic multi-agent workflows behind hard verification gates**, not as a
one-shot code generator.

---

## 1. Tooling & model

- **Driver:** Claude Code (CLI agent) as the orchestrator.
- **Fan-out:** a `Workflow` primitive that spawns N sub-agents in parallel,
  each with a JSON-schema-validated structured return, then synthesizes.
- **Verification gates** (run by the orchestrator after *every* change set):
  `npm run build` (exit 0, also typechecks) · `npm test` (vitest) ·
  `npx eslint <touched>` (no new errors). Nothing is "done" until green.

## 2. The core method: structured multi-agent workflows

Plain single-threaded prompting does not scale to a ~100k-LoC platform. The
work was instead organized as **dynamic workflows** — one orchestrator script
fans out a fleet of sub-agents, each returning a schema-validated result, then
a synthesis agent (or the orchestrator) merges them.

Two patterns recurred:

1. **Audit / understand (read-only fan-out):** one agent per dimension reads
   the real code and returns structured findings with `file:line` evidence; a
   synthesis agent ranks them. Used for the initial codebase audit, the
   architecture review, the billing-system map, and the critical
   spec-vs-implementation audit.
2. **Implement (write fan-out):** one agent per task, **each owning a
   DISJOINT set of files**, run in parallel; the orchestrator then runs the
   verification gates over the combined result and fixes any fallout.

### The hard constraint that shaped everything: disjoint file ownership

This repo is **not** a git repository, so there is no worktree isolation —
two agents editing the same file would clobber each other. Every parallel
fan-out was therefore partitioned so **no two agents touch the same file**.
Cross-cutting work (an error-envelope codemod, an `eslint --fix` pass, a theme
flip, the shared AI client) cannot be partitioned that way, so it is
explicitly marked **serial** and done one at a time. This single rule is why
the plans (`ROADMAP.md`) are structured as "parallel batches + serial items".

### What was deliberately NOT fanned out

- **Money-path code** (payout accrual, withdrawal review, the approval state
  machine). Done by hand, **test-first**, because a silent regression there
  loses real value and unit tests alone don't catch it.
- **Interactive-state refactors with no browser test harness** (e.g. the
  1.9k-line task-creation form's hook extraction). Done by hand as a strict
  behavior-preserving relocation.
- **Anything touching a shared file** two tasks would both need.

## 3. Actual sequence of work

Each phase ended green (build + tests + eslint) before the next began.

1. **Environment & baseline.** Cleaned macOS extraction junk, extracted the
   test-data fixtures, got the suite green as a baseline.
2. **Initial audit (11-agent workflow).** Mapped the codebase + its dual
   identity (annotation core + an LLM-gateway layer), verified the spec areas
   were wired, and surfaced the "empty entry points" UX problem.
3. **Focus mode + white-theme unification (7-agent workflow).** Added a flag
   (default on) hiding the gateway-era surfaces; converted the site to a
   single light palette via the existing `.app-light` token system, with a
   strict "only convert pure-gray values" rule.
4. **Architecture pass.** Split a 1.9k-line schema into domain modules behind
   a barrel; wrote `ARCHITECTURE.md`; added an ESLint-enforced import boundary
   between the annotation core and the gateway layer; dead-code sweep.
5. **Trajectory self-serve loop.** Surfaced + polished the
   wrap-API → capture → annotate-your-own-trajectory flow (in-app API keys,
   capture observability, no-code upload, list pagination).
6. **Operable payment system.** Mapped the billing layer (workflow), then
   rebuilt it into a real admin-credit → balance → withdrawal-request →
   approve/mark-paid loop, **reusing the existing append-only ledger** (one
   new table, no destructive migration). Wired payout accrual on approval
   **test-first**.
7. **God-component decompositions.** The task-creation form (by hand), the
   trajectory detail page, and `eval-run-client` / `designer-shell` /
   `import-wizard` (fan-out) — all **behavior-preserving** relocations
   (move prop-only subcomponents + pure helpers; never touch hooks/state).
8. **Critical spec audit (9-agent workflow).** Re-read `spec.md` and graded
   each requirement against the *competition* bar (excellent / adequate /
   **poor** / missing), producing a ranked gap list + a workflow-batched plan.
9. **Competition hardening (fan-outs + serial).** Fixed a CSV
   data-corruption bug, added themed error/404 boundaries, backfilled tests
   for the data-loss-critical autosave hook, produced this `submission/`
   bundle + portable API docs, then the flagship spec-literal upgrades
   (rich-text editor, JSON-Schema validation, AI tool-use, …).

## 4. Engineering decisions & trade-offs

- **Reuse over rewrite.** The payment system reused the existing
  `transactions` ledger + `wallet_balance` snapshot rather than a new schema —
  one additive table, zero destructive migration.
- **Behavior-preserving decomposition.** God-files were shrunk by moving
  self-contained, prop-driven subcomponents and pure helpers to sibling
  files, never by reorganizing state/effect wiring — so `build` fully verifies
  the change and runtime behavior is provably unchanged.
- **Honest verification.** Some agent-written "tests" are source-scans; these
  were called out, and real behavioral tests were added where it mattered most
  (the money path, the autosave hook). Stale numbers and over-claims in docs
  were corrected rather than left.
- **VPS-aware.** Local file storage + a local Postgres on a small VPS;
  standalone Next build shipped over SSH; no heavy dependencies added without
  cause (e.g. the rich-text editor reuses the existing markdown stack instead
  of pulling in a large WYSIWYG library).

## 5. Where to verify the claims

- `ROADMAP.md` — the live plan: parallel batches, serial items, ranked gaps.
- `ARCHITECTURE.md` — layer contract + diagrams + the enforced boundaries.
- `git`-free history is reconstructable from the per-session memory and the
  workflow transcripts; the **code itself** is the ground truth — every claim
  above is checkable against `src/`, the test suite, and the live deployment
  at https://aipert.top.
