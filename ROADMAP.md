# LabelHub — Competition-Final Plan (spec-audited)

Rewritten 2026-05-31 from a critical **9-agent spec.md-vs-implementation
audit** (judge bar, not "exists = done"). Organized around **dynamic-workflow
batches**: work that touches DISJOINT files is grouped into one parallel
fan-out and run together; cross-cutting / money-path / interactive work is
listed as serial. (There is no git worktree isolation here — same-file edits
collide — so disjoint ownership is what makes a batch parallelizable.)

The old long-horizon M0–M7 plan is delivered; its history lives in memory.
This file is now the **road to a top competition score**.

---

## 0. Honest scorecard (starting baseline — 2026-05-31, pre-batch)

> **Historical baseline**, captured BEFORE the B1–B3 + cross-cutting + Tier 1–3
> batches below landed. Kept to show the journey. **Every "loses on …" item in
> the table has since been closed**: lint is now 0 problems; a real Playwright
> e2e harness exists; the AI verdict uses function-calling; rich-text + json-editor
> were upgraded; per-annotator quota is enforced; the CSV bug is fixed;
> error/404/global-error boundaries shipped; and the money/state writes are wrapped
> in transactions (incl. a close-period double-pay fix). The realistic ~88–90 target
> is reached on the engineering axes — the remaining gap is the human-only §8 demo
> video + screenshots.

**~79 / 100 was the starting point; the completed work below lifts it to ~88–90.**

| Axis | Est. | Why |
|---|---|---|
| Functional (60%) | ~52 | All 6 spec areas real + end-to-end; ⭐⭐⭐ 4.2 Designer/Renderer and 4.4 AI agent genuinely deep, not stubbed. Loses on spec-literal misses (4.4 not function-calling; 4.2 rich-text = textarea; json-editor validation unimpl), CSV bug, quota not enforced. |
| Engineering (25%) | ~16 | Great module boundaries (ESLint-enforced), strict TS, strong docs. **Dragged down by: RED `npm run lint` (25 errors/153 warns), NO e2e/DOM tests + a phantom "Playwright suite", untested autosave hook, ~22/89 tests are source-scans, non-transactional state writes.** |
| Experience (15%) | ~10.5 | Consistent white theme, real responsive breakpoints, first-class undo/draft. Loses on **no error.tsx/not-found.tsx (off-theme crash/404 pages)**, no real toast system (docs over-claim it). |

**Biggest point-loss, in order:** (1) missing §8 deliverables — whole axes
un-scorable; (2) red lint = bad first impression; (3) spec-literal misses in
the two flagship areas judges read word-for-word; (4) a concrete CSV
data-corruption bug; (5) missing error/404 boundaries.

---

## 1. How to run this plan

**Gates (every change):** `npm run build` exit 0 · `npm test` green ·
`npx eslint <touched>` no NEW errors · **and a new hard goal: get `npm run
lint` GREEN repo-wide** (a judge runs it). Behavior-preserving refactors must
not change output.

**Deploy:** local standalone build (hydrate NEXT_PUBLIC) → tar+ssh → restart
labelhub → `/api/health` 200. Prod DB is local Postgres ON the VPS; apply DDL
via `psql` on the VPS, never `db:push` the whole schema. (None of the work
below needs a migration.)

**Batch execution:** each B-batch is launched as ONE `Workflow` fan-out — one
agent per task, each owning the listed disjoint files, with strict
"edit ONLY your files / no new files under actions/ / re-read after". The
human (or me) runs the gates after the fan-out and reviews diffs. Serial
items are done one at a time by hand.

---

## 2. Dynamic-workflow batches (parallel fan-outs)

### B1 — Submission deliverables ⟶ HIGHEST ROI (recovers un-scored axes)
*All net-new files in non-overlapping locations; nothing touches `src/`
runtime. The §8 deliverables are cheap relative to their scoring weight.*

| Task | Owned files | Who |
|---|---|---|
| `submission/` dir + `INDEX.md` linking every deliverable | `submission/INDEX.md`, `submission/README.md` | agent |
| Portable **core-API docs** (annotation/task/review/export REST + actions) | `submission/api/openapi.yaml`, `submission/api/API.md` | agent |
| **AI-coding process record** (real workflow log: audits, fan-outs, decisions) | `submission/AI_CODING_PROCESS.md` | **me** (have the true history) |
| **Demo video** (5–10 min, 3 roles end-to-end) | `submission/demo/` | **human** (interactive; record AFTER B2/B3 land) |
| **Demo screenshots** (Designer, Renderer/answer, AI review, export, billing) | `submission/screenshots/` | **human** (needs running app) |

### B2 — Cheap correctness + polish (disjoint source files, high visibility)
*Each owns a distinct module and fixes a concrete docked item. Run as a
fan-out; gate after.*

| Task | Owned files | Who |
|---|---|---|
| Fix **CSV negative-number corruption** (formula-guard only string cells) + test | `src/lib/export/formatters/csv.ts`, `…/formatters.test.ts` | agent |
| Add **error / not-found / global-error** boundaries in `.app-light` | `src/app/{error,not-found,global-error}.tsx` | agent |
| Fix 3 `no-explicit-any` lint errors | `src/lib/templates/rubric.test.ts` | agent |
| **Autosave-hook unit tests** (debounce, de-dupe, retry, restore, beforeunload) | `src/components/topic-annotate/use-autosave-draft.test.ts` | agent |
| Stale-doc truthfulness (test counts 92/975, fix lark-spec path, drop toast over-claim) | `README.md`, `ARCHITECTURE.md`, `docs/DEMO.md` | agent |

### B3 — Flagship spec-literal upgrades (separate components)
*Raises the two ⭐⭐⭐ areas to the exact words judges check. Needs deps
(serial install first — see §3).*

| Task | Owned files | Who |
|---|---|---|
| 4.2 rich-text runtime → real WYSIWYG (lexical / contentEditable) | `src/components/form-materials/rich-text-field.tsx` | agent |
| 4.2 json-editor → real draft-07 validation (ajv) when `jsonSchema` set | `src/components/form-materials/json-editor-field.tsx` | agent |
| 4.4 AI verdict → true **tool-use** (input_schema for verdict/dimensions/reasoning) | `src/lib/ai/review-agent.ts` | **me** (touches shared AI client — see §3) |
| Surface owner rubric as a labeled field in the review workbench | `src/components/review/review-detail.tsx` | agent |

---

## 3. Serial items (CANNOT parallelize — one at a time)

1. ~~**Dependency install** (ajv for json-editor draft-07).~~ **DONE** —
   `ajv@8.20` + `ajv-formats@3.0`. (No lexical — rich-text reuses the existing
   react-markdown stack instead, keeping the VPS bundle lean.)
2. ~~**AI client tool-use**~~ **DONE** — `client.ts` gained a portable
   `tools`/`toolChoice`/`toolUse` contract (native Anthropic tool-use +
   OpenAI-compat `function` mapping); `review-agent.ts` now FORCES a
   `submit_verdict` tool call (spec 4.4 Function Calling), with a graceful
   fallback to the json-parse path for providers without tool support. Tests:
   review-agent + client suites extended (tool-use path + forced-tool assert).
3. ~~**Auto-claim status gate + version CAS**~~ **DONE** — `saveDraftAnnotation`
   and `submitAnnotation` now gate the auto-claim on `task.status==='open'`
   (mirrors `claimTopic`), and `submitAnnotation`'s straight-to-submit claim is
   now a version-CAS write (was a naive un-guarded claim — a real concurrency
   bug). New gate test in `save-draft-claim.test.ts`.
4. **State-machine canonicalization + `db.transaction`** — **DEFERRED (documented).**
   The canonical `applyTransition()` machine exists and `qc-review.ts` already
   routes through it, but `submitAnnotation`'s runtime model intentionally
   differs from the machine's `drafting→ai_review` edge: submit lands the topic
   in `submitted`, and the AI scheduler (`ai-review-submission.ts`) then decides
   `ai_review` vs `submitted`. Reconciling the two — plus wrapping
   status-update+event-insert in a `db.transaction` across three actions —
   is the single riskiest change in the plan and has **no integration/e2e test
   harness** to catch a regression on the money/state path. Deferred to a
   dedicated test-first session rather than risk it blind. (Optimistic-lock
   version CAS already protects every status transition individually.)
5. ~~**`eslint . --fix` → lint GREEN**~~ **DONE** — `npm run lint` is now
   **0 problems / exit 0** (was 22 errors / 153 warnings). Auto-fix removed
   123 stale disable directives; hand-fixed: 10 `no-html-link`→`<Link>`,
   6 `set-state-in-effect` (justified — mount-hydration / prop-resync),
   2 `purity` (1 server-component justified, 1 real `key`+timer fix in
   atomic-rubric-row), 3 unescaped entities, 1 prefer-as-const, ~14 unused
   imports; config now honors the `^_` intentionally-unused convention.
6. **Record the demo video + screenshots** — **HUMAN-only**, after this batch
   deploys, so it shows the polished build.

---

## 4. Ranked gap table (from the audit)

| Sev | Kind | Area | Item |
|---|---|---|---|
| CRIT | missing | §8 | Demo video; submission/ dir; AI-coding process record |
| HIGH | missing | §8 | Demo screenshots; portable core-API docs |
| HIGH | poor | Eng | `npm run lint` RED (25 err/153 warn); NO e2e/DOM tests (phantom Playwright) |
| HIGH | poor | 4.4⭐ | Uses json_object+Zod, NOT spec-named function-calling/tool-use |
| HIGH | poor | 4.2⭐ | rich-text runtime is a plain textarea (no WYSIWYG) |
| HIGH | poor | 4.6 | CSV export corrupts negative numbers |
| HIGH | missing | Exp | No error.tsx / not-found.tsx / global-error.tsx (off-theme fallbacks) |
| HIGH | poor | 4.3/Eng | Autosave hook (data-loss-critical) has zero direct tests |
| MED | poor | 4.5 | submit/terminal-review/AI-routing bypass the canonical state machine; no db.transaction |
| MED | poor | 4.1 | Status machine doesn't gate auto-claim in save/submit; quota never enforced |
| MED | poor | 4.6 | Task-export route fully synchronous (50k cap), no async/history |
| MED | poor | 4.2⭐ | json-editor draft-07 validation documented but unimplemented |
| LOW | poor | Exp/Eng | No toast system (docs over-claim); ~22/89 tests are source-scans; stale doc counts |

---

## 5. Deliverables checklist (spec §8)

- [ ] Demo video (5–10 min, 3 roles) — **MISSING (critical, human-only)**
- [ ] Demo screenshots — **MISSING (human-only — capture after B3 UI fixes)**
- [x] `submission/` consolidated dir — **DONE** (INDEX.md + README.md)
- [x] AI-coding process record — **DONE** (`submission/AI_CODING_PROCESS.md`)
- [x] Portable core-API docs — **DONE** (`submission/api/openapi.yaml` 3.1 + `API.md`)
- [x] README (arch/modules/local-start/tradeoffs) — present (counts + lark-spec path fixed)
- [x] ARCHITECTURE.md + diagrams — present
- [x] Deployable demo-env doc + scripts — present; live at https://aipert.top

> **Batch status (2026-05-31):** B1+B2 DONE (submission dir + API docs +
> **AI_CODING_PROCESS.md**; CSV bug, error/404/global-error boundaries,
> lint-any, 29 autosave tests, doc truthfulness). **B3 DONE** (rich-text
> markdown WYSIWYG, json-editor draft-07 ajv validation, review rubric
> surfacing) + **4.4 AI tool-use DONE** + **auto-claim status-gate / submit
> version-CAS DONE** + **`npm run lint` GREEN (0 problems)**. Verified:
> build 0 / **1058 tests** / lint 0. The §3.4 state-machine transaction work
> is now DONE too: money/state writes are wrapped in db.transaction (incl. a
> close-period double-pay fix), and submit/review are canonicalized through
> applyTransition. A Playwright e2e harness was added. Remaining: the
> human-only demo video + screenshots. The cross-cutting + core→billing
> inversion batch shipped to https://aipert.top on 2026-06-01; the Tier 1–3
> batch is **built + green, awaiting "上线".**

> **Final status (2026-06-10, submission day):** everything above plus the
> later batches is **shipped to https://aipert.top**: operable billing
> (credit → balance → withdrawal approve/mark-paid), `npm run doctor`
> pipeline health-checks, **two-stage human review (spec §9.3 初审→终审,
> default ON, server-enforced)**, AI-assisted template design, pre-submit AI
> quick-check, and the white SaaS visual pass. Submission-day gates:
> **vitest 1109 (106 files) / lint 0 / verify-spec 46/46+5/5 / build exit 0.**
> Remaining human-only: record the demo video + capture screenshots
> (`submission/demo/SCRIPT.md`).

---

## 6. Sharp edges (read before touching)

- Prod DB is local Postgres on the VPS (`127.0.0.1:5432`); Supabase is
  auth-only. Apply DDL via `psql` on the VPS.
- Drizzle migration snapshot is drifted — `db:generate` lies; hand-write
  additive DDL.
- `LABELHUB_FOCUS_MODE` (default ON) hides marketplace surfaces; the
  trajectory loop is core.
- annotation-core must not import the gateway layer (ESLint-fenced for the lib
  slices; `actions/annotations.ts → lib/billing` is the documented exemption).
- New pages must opt into `.app-light` or render dark (`:root` flip pending).
