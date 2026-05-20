# LabelHub Finals · 20-Day Execution Plan

## Context

LabelHub passed competition prelims with its "Annotation-Aware LLM Gateway" thesis (proxy + topic-scope guardrail + teaching-signal export). Finals deadline is in **20 days**.

The official spec (`https://bytedance.larkoffice.com/docx/I99RdqcPloBCqlxYLVocStaTnMe`) scores 60% functionality / 25% engineering / 15% UX. Re-reading the spec revealed the user's earlier belief ("backend must be Java/Go/Python") was wrong — section 6 explicitly says "**非强制**". TS/Node.js + Postgres stay.

But the spec's 6 required features include two that LabelHub currently lacks entirely:
- **4.2 动态表单 Designer ⭐⭐⭐** — drag-drop visual form builder with 9 materials, JSON Schema serialization, Designer/Renderer decoupling, field linkage, custom validation, group/tab containers. **Zero coverage today** — templates are hard-coded as 3 modes.
- **4.4 AI 审核 Agent ⭐⭐⭐** — owner-configurable Prompt + scoring dimensions, per-submission auto-trigger, Function Calling structured output, verdict (pass / send-back / human-review), retry + idempotency. LabelHub has `llmJudges` for admin-batch use only — not per-submission.

Other gaps (smaller): multi-format export (only JSONL), `ai_review` state-machine node, dedicated reviewer workbench, batch ops, multi-format data import, formal API docs, demo video.

Intended outcome: ship a finals build that hits 90%+ of spec functionality while keeping the Gateway thesis as the differentiator in the 60-second demo video. Existing 440 tests stay green; existing prod deploy stays working.

---

## Strategic posture

- **Don't rewrite the backend.** TS + Next.js + Postgres remain. Saves ~4 weeks of risk.
- **Extend, don't replace, the template engine.** Add a 4th mode `custom-designer` alongside `pair-rubric` / `arena-gsb` / `agent-trace-eval` — same registry, new schema-driven path. Stays inside Pillar 4.
- **Mirror proven patterns.** AI Review Agent borrows the `scheduleHintsIfMissing` after-hook from `src/lib/actions/trajectory-hints.ts:52-80` verbatim. LLM Function Calling reuses `responseFormat: 'json_object'` + Zod from `src/lib/ai/judge.ts:114-175`. Quota gate reuses `assertWithinDailyAIQuota` from `src/lib/ai/quota.ts`. Event sourcing (Pillar 2) covers the new audit transitions for free.
- **Allocate the 3⭐ gaps the most time.** Designer (P1, D2-D6 = 5 days) and AI Agent (P2, D7-D10 = 4 days) are early-middle weeks. Smaller surfaces fit around them.
- **Keep daily quality gate.** `lint && test && build` + smoke against `labelhub-gamma.vercel.app` at end of every day. Day doesn't ship if any fail.

---

## Phase map

| Phase | Days | Theme | Spec |
|---|---|---|---|
| P0 | D1 | Schema + scaffolding + branch hygiene | foundation |
| P1 | D2-D6 | Dynamic Form Designer + Renderer | 4.2 |
| P2 | D7-D10 | AI Review Agent (per-submission) | 4.4 |
| P3 | D11-D13 | Review workbench + state machine + batch ops | 4.5 |
| P4 | D14-D15 | Task import + multi-format export | 4.1, 4.6 |
| P5 | D16 | Labeler workbench polish | 4.3 |
| P6 | D17-D18 | Engineering quality — tests, docs, perf | 25% bucket |
| P7 | D19 | UX polish + demo video | 15% bucket |
| P8 | D20 | Buffer / final hardening | risk absorption |

---

## Day-by-day

### D1 — Foundation
- New branch `finals/main`; CI pinned to current green main.
- Drizzle migration draft `drizzle/0001_finals.sql` (review only, NOT applied): `custom_form_schemas`, `ai_submission_verdicts`, `export_jobs` tables. Extend `workflow_stage` enum with `'ai_review'` via `ALTER TYPE ... ADD VALUE`.
- `src/lib/templates/types.ts` — add `'custom-designer'` to `TEMPLATE_MODES`; add optional `customSchema` field to `PlatformTemplate`.
- This plan file mirrored to repo as `docs/finals-plan.md`.

**Gate**: 440 baseline green, no behavior change.

### D2 — Designer skeleton
- Install `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (React 19 compatible).
- Build a vanilla SortableContext smoke first to confirm React 19 + Next 16 turbopack compatibility — fallback `react-dnd` if broken.
- New folder `src/components/form-designer/` with `canvas/`, `palette/`, `properties/`, `materials/`.
- `src/components/form-designer/designer-shell.tsx` — three-pane layout, placeholder canvas.
- `src/lib/form-designer/schema.ts` — Zod `FormSchema` (fields[], groups[], tabs[], version: 1).
- `src/app/admin/forms/new/page.tsx` — admin-only route.

**Gate**: build green; empty canvas renders at `/admin/forms/new`.

### D3 — Materials library (9 widgets)
- `src/components/form-designer/materials/` — one file per widget: `text-field`, `textarea-field`, `single-select-field`, `multi-select-field`, `rich-text-field`, `file-upload-field`, `json-editor-field`, `llm-trigger-field`, `show-item-field`.
- `materials/registry.ts` — central registry. Each material exports `{ designerPreview, runtimeRenderer, propertyPanel, defaultConfig }` so palette/canvas/properties consume one API.
- Drag-from-palette → drop-on-canvas wires up with sortable list + Jotai atom for canvas state.

**Gate**: each of 9 materials drops onto canvas; refresh restores from local Jotai state.

### D4 — Property panel + JSON Schema serializer
- `properties/property-panel.tsx` — right-pane editor, switches on selected field's `kind`.
- Per-material property panels: label, required, placeholder, default, validation regex, options (select), maxLength, accept (file), helperText, llmPromptTemplate.
- `src/lib/form-designer/serialize.ts` — `formSchema ↔ JSON Schema (draft-07)` round-trip. Custom keywords (`x-labelhub-kind`, `x-labelhub-llm-prompt`, etc.).
- `src/lib/form-designer/serialize.test.ts` — round-trip property test per widget (~25 tests).
- `canvas/canvas.tsx` — selection state, delete, reorder via `SortableContext`.

**Gate**: build 5-field form → serialize → deserialize → byte-identical canvas state.

### D5 — Field linkage + custom validation + group/tab containers
- `src/lib/form-designer/linkage.ts` — `visibleWhen` / `requiredWhen` JSON predicates + evaluator. Mirror the existing `ConditionalDisplay` shape in `src/lib/templates/types.ts:146-149` for consistency.
- `properties/linkage-editor.tsx` — UI for "show this field when field X = Y".
- `src/lib/form-designer/validation.ts` — custom validator DSL (regex / range / length / cross-field) compiling to Zod.
- `materials/group-field.tsx` — nested `SortableContext`.
- `materials/tab-layout.tsx` — top-level tabs with per-tab field arrays.
- Tests: linkage (~15), validator compile (~10), nested container serialize (~8).

**Risk**: nested DnD is the most likely slip day. If running long, cut tab layout to D6 morning. Group container is non-negotiable.

**Gate**: form with `{textarea required, select with options, textarea visible-when select=='other'}` serializes, deserializes, validates per-field in unit test.

### D6 — Renderer + Designer/Renderer decoupling + persistence
- `src/components/form-renderer/form-renderer.tsx` — consumes serialized schema only; **must not import any `form-designer/` module**. Uses `materials/registry.ts` for runtime widgets.
- `src/lib/form-designer/storage.ts` — server action save/load `custom_form_schemas` table.
- `src/lib/templates/modes/custom-designer.ts` — register 4th template mode; `templateConfig.formSchemaId` references saved schema.
- `src/components/task-admin/create-task-form.tsx` — add "Custom Form" option that lists workspace's saved schemas.
- `src/components/topic-annotate/custom-form-annotate.tsx` — Labeler entrypoint; hydrate Renderer with topic payload + draft.
- Reuse `src/components/topic-annotate/use-autosave-draft.ts` verbatim.
- ESLint custom rule blocking `form-renderer/` from importing `form-designer/*`.
- E2E test: create custom-designer task → load Labeler → fill form → autosave → reload → draft restored.

**Gate**: full Designer → save → assign to task → Labeler renders → submit round trip. P1 functional milestone.

### D7 — AI Review Agent schema + scheduler skeleton
- Migration applied: `ai_submission_verdicts` (annotation_id FK, judge_id FK, status, verdict, scores jsonb, reasoning, attempts, error_text, idempotency_key, created/finished timestamps).
- `src/lib/actions/ai-review-submission.ts` — **mirror `src/lib/actions/trajectory-hints.ts:52-80` exactly** (`scheduleHintsIfMissing` fire-and-forget pattern).
- Wire `after(() => scheduleAIReviewIfMissing({ annotationId }))` into `src/lib/actions/annotations.ts` at existing `after()` sites (lines 556, 578, 595). Only on submit transitions, not draft saves.
- Owner-side config UI scaffold `src/app/admin/tasks/[id]/ai-agent/page.tsx`: Prompt textarea + scoring dimension editor (reuse arena-gsb dimension editor from `src/components/task-admin/create-task-form.tsx` as visual pattern).

**Gate**: submitting enqueues a verdict row with `status='pending'`; submit latency unchanged.

### D8 — AI Agent Function Calling + verdict storage
- `src/lib/ai/review-agent.ts` — call `chat()` from `src/lib/ai/client.ts` with `responseFormat: 'json_object'` (same pattern as `src/lib/ai/judge.ts:114-175`). Function-call schema: `{ verdict: 'pass'|'send_back'|'human_review', score: 0-100, dimensions: {[name]: score}, reasoning: string }`.
- Reuse `assertWithinDailyAIQuota` — `feature: 'review-agent'`.
- Idempotency: `idempotency_key = sha256(annotationId + judgeId + schemaVersion)`.
- Retry: 3 attempts with exponential backoff (1s/4s/16s) in after-hook; final failure → `status='failed'` surfaced in audit timeline.
- Tests: Zod parse (~8), retry with mock (~6), idempotency (~4), quota exhaustion (~3).

**Risk**: Vercel function timeouts. Pattern in `trajectory-hints.ts` already addresses; if hit, push to Supabase Edge Function.

**Gate**: submit → after-hook → LLM call → verdict row → re-submit is no-op.

### D9 — Owner config UI complete + verdict routing
- `src/app/admin/tasks/[id]/ai-agent/page.tsx` complete: prompt editor with token counter, scoring dimensions CRUD, pass/send-back thresholds, on/off toggle per task, dry-run preview button.
- Apply enum extension migration: `'ai_review'` slots between `submitted` and `reviewing`.
- Verdict routing: `pass` → `reviewing` queue; `send_back` → `drafting` with reason in `annotation_revisions`; `human_review` → priority queue flag.
- Event types: `ai_review.started`, `ai_review.completed`, `ai_review.failed`, `ai_review.sent_back`.

**Gate**: Owner can configure agent in <1 min; same annotation routes differently based on threshold tweak.

### D10 — AI Agent integration tests + Labeler "AI assist" per field
- Integration tests `src/lib/actions/__tests__/ai-review-submission.test.ts` (~20): pass / send-back / human-review paths, retry exhaustion, idempotency under concurrent submits, after-hook isolation.
- Per-field LLM assist button in Renderer (`llm-trigger-field.tsx`): clicks call existing `src/lib/actions/ai.ts` with field context; result fills the field.
- Rate limit per user (10/min) via existing `src/lib/ratelimit/`.

**Gate**: 4.4 + 4.3 LLM-assist requirements both functional. ~40 new tests added in P2 cumulative.

### D11 — Review workbench (4.5 part 1)
- `src/app/review/page.tsx` — reviewer's queue (mirror `src/app/my/queue/page.tsx` shape). Filters: stage, task, AI verdict, annotator.
- `src/app/review/[annotationId]/page.tsx` — single-annotation view: form values rendered read-only via Renderer, AI verdict panel beside, send-back form below.
- `src/components/review/diff-view.tsx` — query `annotation_revisions`, compute field-level diffs across revisions, render side-by-side.
- `src/components/review/batch-action-bar.tsx` — multi-select + batch approve / batch send-back with shared reason.

**Gate**: reviewer can clear a 20-item queue with batch approve in <2 min.

### D12 — State machine hardening + audit trail UI (4.5 part 2)
- `src/lib/quality/state-machine.ts` — formalize 8 transitions (drafting → submitted → ai_review → reviewing → awaiting_acceptance → approved/rejected, plus revising loop). Pure function, tested in isolation.
- Replace ad-hoc stage updates in `src/lib/actions/qc-review.ts` and `src/lib/actions/annotations.ts` with state-machine calls — illegal transitions throw.
- `src/components/review/audit-timeline.tsx` — extend existing `src/components/quality/annotation-audit-timeline.tsx` to render new `ai_review.*` events with diffs.
- Tests: every legal transition (~22), every illegal (~30), idempotency under double-click (~5).

**Gate**: 4.5 audit trail complete with Labeler → AI → Reviewer → DB lineage.

### D13 — Inbox + notifications + permission audit
- Wire AI verdict + send-back events into existing `src/lib/notifications/` system. Labeler sees "AI sent it back: reason X" in `/inbox`.
- `docs/ROLE_PERMISSIONS.md` updated with new ai_review stage + Owner agent-config permission.
- Security smoke: cross-workspace verdict isolation, non-owner cannot edit agent config, non-reviewer cannot batch-approve.
- Candidate demo recording for self-review.

**Gate**: end-to-end happy path runs cleanly with seed data.

### D14 — Batch task import (4.1) + parsers
- Add deps: `xlsx` (sheetjs CE) for Excel; native streaming for CSV.
- `src/lib/import/parsers/` — `json.ts`, `jsonl.ts`, `excel.ts`, `csv.ts`. Each returns `AsyncIterable<{ row: unknown, lineNumber: number, error?: string }>`.
- `src/app/admin/tasks/[id]/import/page.tsx` — upload + column mapping UI (auto-detect header → suggest mapping → preview 10 rows → confirm).
- Extend `src/lib/actions/topics.ts:createTopicsBatch` to accept parsed-row iterator; per-row validation; partial-success report with row-level errors.
- `src/lib/import/distribution.ts` — 3 named strategies: `random`, `round-robin`, `quota-by-annotator`.
- Tests: each parser against fixture (~8 × 4 = 32), strategies (~12), partial-failure (~6).

**Risk**: malformed Excel sheets. Streaming + per-row try/catch; one bad row never aborts the batch.

**Gate**: import 1000-row JSONL + 500-row Excel without page hang.

### D15 — Multi-format export (4.6) + async job
- `src/app/api/export/dataset/route.ts` — extend (165 lines today). Add `format=json|jsonl|csv|excel`.
- `src/lib/export/formatters/` — `json.ts`, `jsonl.ts`, `csv.ts`, `excel.ts`. Each accepts manifest entries iterator + field mapping config.
- Small jobs (<5MB) stream directly. Larger → enqueue `export_jobs` row; `GET /api/export/jobs/[id]` polls; finished → Supabase Storage download URL.
- `src/app/admin/exports/page.tsx` — export history + download links + field mapping editor.
- Field mapping: `{ source: 'annotation.payload.x', target: 'column_name', transform?: 'json_stringify' }[]`.
- Tests: each formatter against canonical fixture (~4 × 8 = 32), mapping round-trip (~10), async job lifecycle (~6).

**Gate**: export 10k-row dataset as Excel in <30s; download from history works after page refresh.

### D16 — Labeler workbench polish (4.3)
- `src/app/my/queue/page.tsx` — fill out "task plaza" affordances: filter by task type, status badge, ETA per item from workspace median.
- Prev/Next within a task at `/my/tasks/[taskId]` — keyboard shortcuts (J/K, arrow keys).
- AI hint indicator on each field with `llm-trigger` material configured.
- Mobile responsiveness pass on Labeler surface (1 of 3 demo recording targets).
- Loading skeletons for Renderer.

**Gate**: a fresh Labeler completes 5 items without reading docs.

### D17 — Tests to ≈590
- Coverage report; target: every new server action, lib/ module, state-machine transition, formatter, parser.
- Add ~50 missing tests across P1-P5 to hit the ~150 new-test target.
- Confirm 440 baseline still green AND ≥150 new tests added.
- Perf: Designer canvas with 200 fields uses virtualization; Renderer with 200 fields uses Jotai atomFamily (Pillar 4 perf rules).
- Bundle: Designer code-split out of Labeler bundle (decoupling from D6).

**Gate**: total tests ≥590; ≥80% coverage on new modules; Designer NOT in Labeler bundle.

### D18 — Docs + observability
- `docs/API.md` — formal endpoint docs. Every endpoint: method, path, request schema, response schema, error codes, auth, example curl.
- `README.md` — finals section: architecture diagram (mermaid), 6-feature checklist with file pointers, 3-min quickstart for judges.
- `docs/AI_AGENT.md` — auto-trigger pattern, function-calling schema, retry semantics, idempotency keys (differentiator material).
- 5 canonical audit-log queries judges can run to verify lineage.

**Gate**: a judge reading only `README.md` + `docs/API.md` can identify how each spec section is implemented.

### D19 — UX polish + demo video
- Pass through every new surface: empty states, error toasts, copy clarity, color contrast, keyboard nav.
- 60-second demo video script + record (shot list below).
- Upload `/public/demo.mp4` + link from README.
- Final smoke on labelhub-gamma.vercel.app with fresh seed.

**Gate**: video <60s, every required spec surface visible, no broken transitions.

### D20 — Buffer / final hardening
- Drain issue list accumulated during D1-D19.
- `scripts/_prod-smoke.ts` extended with 6 new feature flows.
- Verify production secrets, migrations applied, demo workspace seeded.
- Tag `v-finals-final`; freeze main; submit.

**Gate**: smoke script returns 0; URL load <3s p75.

---

## Critical files to modify (highest-impact list)

| File | Action | Why |
|---|---|---|
| `src/lib/templates/types.ts` | Extend | Add `'custom-designer'` to `TEMPLATE_MODES`; foundation for 4.2 |
| `src/lib/templates/modes/custom-designer.ts` | New | Register 4th template mode |
| `src/lib/db/schema.ts` | Extend | New tables `custom_form_schemas`, `ai_submission_verdicts`, `export_jobs`; extend `workflowStageEnum` with `'ai_review'` |
| `src/components/form-designer/` (folder) | New | Designer canvas, palette, materials registry, properties panel (~15 files) |
| `src/components/form-renderer/form-renderer.tsx` | New | Schema-driven runtime form; consumes only `materials/registry.ts` |
| `src/lib/actions/ai-review-submission.ts` | New | Mirror `src/lib/actions/trajectory-hints.ts:52-80` for per-submission AI review |
| `src/lib/ai/review-agent.ts` | New | Function-calling wrapper around `src/lib/ai/client.ts:chat()` |
| `src/lib/actions/annotations.ts` | Extend | Add `after(() => scheduleAIReviewIfMissing(...))` at lines 556/578/595 |
| `src/lib/quality/state-machine.ts` | New | Formalize 8 transitions as pure function |
| `src/app/review/page.tsx` + `src/app/review/[id]/page.tsx` | New | Reviewer workbench, batch ops |
| `src/lib/import/parsers/{json,jsonl,csv,excel}.ts` | New | Multi-format ingest |
| `src/lib/export/formatters/{json,jsonl,csv,excel}.ts` | New | Multi-format export |
| `src/app/api/export/dataset/route.ts` | Extend | Add `format=json\|jsonl\|csv\|excel` switch |
| `docs/API.md`, `docs/AI_AGENT.md` | New | 25% engineering bucket; judge readability |
| `public/demo.mp4` | New | 15% UX bucket |

---

## Reused functions / patterns (with paths)

- `src/lib/ai/judge.ts:114-175` — `responseFormat: 'json_object'` + Zod parse + code-fence strip pattern. Copy into `review-agent.ts`.
- `src/lib/actions/trajectory-hints.ts:52-80` — `scheduleHintsIfMissing` fire-and-forget after-hook. Mirror exactly in `ai-review-submission.ts`.
- `src/lib/actions/annotations.ts:556-605` — three `after()` sites where the new AI-review scheduler attaches.
- `src/lib/ai/quota.ts:assertWithinDailyAIQuota` — call before each AI Review LLM hit.
- `src/lib/ai/client.ts:chat()` — provider-agnostic wrapper for all AI calls.
- `src/components/topic-annotate/use-autosave-draft.ts` — wrap Renderer's `onChange` directly.
- `src/components/topic-annotate/pair-rubric-form.tsx` + `arena-gsb-form.tsx` — schema-driven state init reference for Renderer.
- `src/components/quality/annotation-audit-timeline.tsx` — extend with new `ai_review.*` event types.
- `src/lib/notifications/emit.ts` — emit Labeler "AI sent back" inbox notifications.
- `src/lib/ratelimit/public-endpoint.ts` — per-user rate limit pattern for per-field LLM assist.
- Existing roles (`admin` → Owner, `qc` → Reviewer, `annotator` → Labeler, AI as system actor with `events.actorId = null`) — no rename, no migration.
- Audit log: `events` table + `AUDIT_EVENT_GROUPS` in `src/lib/queries/audit-log.ts` — extend with `ai_review.*` group.

---

## Verification

### Per-day gate (every day, end of day)
```bash
npm run lint && npm test && npm run build
curl -sS https://labelhub-gamma.vercel.app/api/health
```
Day doesn't ship if any fails.

### Per-phase gates

| Phase | Gate | Pass criterion |
|---|---|---|
| P0 (D1) | `npm test` | 440 baseline green |
| P1 (D6) | Full Designer → save → assign → render → submit round trip | Bytes preserved through serialize/deserialize |
| P2 (D10) | `npm test src/lib/actions/__tests__/ai-review-submission.test.ts` | 20 new tests green; submit latency unchanged |
| P3 (D13) | Manual: every illegal state transition rejects | 0 illegal transitions accepted |
| P4 (D15) | `node scripts/_prod-smoke.ts` extended | 10k-row Excel export <30s |
| P5 (D16) | Manual: fresh Labeler completes 5 items, no docs | 0 console errors |
| P6 (D17-18) | `npm test -- --coverage` | ≥590 tests, ≥80% on new code |
| P7 (D19) | Demo video plays end-to-end | Every spec surface visible |
| P8 (D20) | Tag + `vercel deploy --prod` + extended smoke | URL p75 <3s |

### End-to-end demo flow (judges' path)
1. Open `https://labelhub-gamma.vercel.app/admin/forms/new` → drag 4 fields → link "details" to "category=other" → save schema.
2. Create task using that schema; import 100 rows via Excel.
3. Login as Labeler at `/my/queue` → open task → fill form → click LLM-assist on textarea → submit.
4. After-hook triggers `ai_review`; verdict appears within ~5s.
5. Login as Reviewer at `/review` → see queue with AI verdicts → batch-approve 20 items.
6. Audit timeline shows Labeler → AI → Reviewer lineage.
7. Export same dataset as Excel + JSONL; download from `/admin/exports` history.

---

## Cross-cutting risks + mitigations

| Risk | Likelihood | Impact | Mitigation | Likely slip day |
|---|---|---|---|---|
| dnd-kit + React 19 + Next 16 turbopack | Med | High | D2 vanilla SortableContext smoke test; fallback `react-dnd` | D2-D3 |
| Nested DnD (group container) | High | Med | Cut tab layout to D6 morning if needed | D5 |
| LLM cost spike from auto-trigger | Med | Med | Existing quota + default cap 50 verdicts/task/day + workspace budget banner | D8 |
| Vercel 10s timeout on agent | Med | Med | Already proven in `trajectory-hints.ts`; fallback Supabase Edge Function | D8-D10 |
| Excel parser memory blowup | Low | High | Streaming row-by-row; 50MB hard input cap | D14 |
| 440 baseline turns red after enum migration | Med | High | `ALTER TYPE ... ADD VALUE`, not column-replace; daily CI gate | D7 |
| Designer/Renderer decoupling violated under pressure | Med | Med | ESLint custom rule blocking cross-import, added D6 morning | continuous |
| Demo video re-records eat D19 | Med | Low | Storyboard scripted D17; D19 = recording only | D19 |

---

## Demo video shot list (60s target, narrated)

1. (5s) Title card — "LabelHub · Annotation-Aware LLM Gateway" — references the prelims thesis differentiator.
2. (10s) Designer — drag 4 fields onto canvas, link "details" to "category=other", save schema.
3. (5s) Task created from that schema; JSONL import drops 100 rows.
4. (10s) Labeler workbench — form auto-renders, click LLM-assist on textarea → field fills, submit.
5. (10s) After-hook fires (animate the queue); AI agent verdict arrives — one passes, one sends back.
6. (10s) Reviewer batch-approves 20 items; audit timeline scrolls showing Labeler → AI → Reviewer lineage.
7. (5s) Export as Excel + JSONL side by side; download from history.
8. (5s) Gateway thesis callout — "Annotations + AI verdicts → teaching dataset → train Gateway" closes the loop.

---

## Stretch goals (if D17-D19 finish early — priority order, ≤1 day total)

1. Field-level diff side-by-side per revision (not just whole-payload diff).
2. Designer template marketplace — 3 pre-built schemas (chat eval / RAG QA / agent trace) as workspace presets.
3. Bulk re-run AI verdicts — admin button to re-judge a frozen set with a new prompt.
4. Conditional branching in Designer — extend linkage to `disable` and `setValue`, not just `visible`.
5. Export field-mapping templates saved per workspace.
6. Mobile-first Labeler PWA manifest at `public/manifest.json` (IndexedDB layer already supports offline writes).

---

## Must-survive cut list (if D18 looks like it'll miss)

Drop in this exact order. Each buys ~half-day. **Do NOT cut past line 4.**

1. Demo video 60s → 30s — skip title card (shot 1) and gateway callout (shot 8).
2. Skip `docs/AI_AGENT.md` standalone; fold key paragraphs into README.
3. Skip distribution strategy `quota-by-annotator`; ship `random` + `round-robin` only.
4. Skip async export jobs >5MB; ship streaming only (10k-row Excel takes ~45s blocking — acceptable for demo).
5. Skip linkage editor UI (engine works, owner edits JSON). UX section bleeds 2 points.
6. Flatten group container to single-level (no nesting).
7. Single-tab Designer (no tab layout). **Last resort — risky.**

**Do NOT cut**:
- AI agent auto-trigger on submit (4.4 core, 3 stars)
- Function Calling structured verdict (4.4 core)
- Designer/Renderer decoupling (4.2 core, called out by name)
- JSON Schema serialization (4.2 core, called out by name)
- Audit trail (4.5 core)
- Excel + CSV export (4.6 core — JSONL alone insufficient)
- 440-test green floor (25% engineering bucket bleeds if red)

---

## Daily routine

- **08:30** — read yesterday's gate; pull main; `npm install` if deps changed.
- **09:00-12:00** — block 1 (cognitively heaviest work — Designer / state machine).
- **13:00-17:00** — block 2.
- **17:00-17:30** — gate: `lint && test && build`; commit; push.
- **17:30-18:00** — smoke labelhub-gamma; update `docs/finals-plan.md` with day outcomes; carry forward unfinished items.
