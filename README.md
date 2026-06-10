# LabelHub

A data-annotation platform. An **Owner** builds tasks and drag-and-drop form
templates → **Labelers** annotate → an **AI agent** pre-reviews each
submission → human **Reviewers** run a **two-stage review (初审 → 终审,
spec §9.3, server-enforced, per-task toggle)** to accept or send back →
datasets export as JSON / JSONL / CSV / Excel.

**Live:** https://aipert.top
**Stack:** Next.js 16 (App Router) · React 19 · TypeScript (strict) · Drizzle ORM / Postgres · Supabase Auth

---

## The one thing to know first

LabelHub is **two products in one repo**:

- **Annotation core** — the spec'd product: workspaces → tasks → templates →
  labeling → AI + human review → quality → export.
- **LLM-gateway layer** — wrap your LLM API through a proxy, capture the agent
  **trajectory**, and annotate your own runs (plus judges / eval-runs /
  billing). The dependency only ever points **gateway → core**, never the
  reverse — and that boundary is now enforced in CI.

Which half you're touching determines almost everything. `ARCHITECTURE.md` §1
explains it in one table.

---

## The AI reviewer is a first-class actor (not a fake user)

The AI pre-review agent (spec §3 / §4.4) is a **system identity**, not a row in
the `users` table. Every verdict is still independently attributable and fully
auditable: it lands in its own `ai_submission_verdicts` row, emits `ai_review.*`
events to the audit log, occupies an `authorRole: 'ai'` lane in the review
thread, and exports under `ai_review_*` columns. That satisfies §3's "独立账户
视角 + 审核记录可追溯" without coupling a backend service to the human-account
table — a deliberate tradeoff: **identity-by-role, not identity-by-user-row**.

---

## Where to look first (5-minute tour)

1. **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — the map. The layer contract
   (§3, with a request-path diagram), the data model (§4, ER diagram), the
   dual-identity boundary (§9, dependency diagram).
2. **`ARCHITECTURE.md` §8** — the spec → implementation map (where each of the
   six assignment areas lives in the code).
3. **Designer / Renderer split** — `components/form-designer/*` builds form
   schemas; `components/form-renderer/*` renders them. They're decoupled by an
   ESLint fence (`eslint.config.mjs`).
4. **The write contract** — open any `src/lib/actions/*.ts`: `'use server'` →
   Zod → auth guard → version-checked update → events → `revalidatePath`.
5. **[`NETWORK_AND_DEPLOYMENT.md`](./NETWORK_AND_DEPLOYMENT.md)** — runtime
   topology, storage config, and how it ships.

---

## Quickstart

```bash
npm install
npm test          # ~1068 tests across 101 files (vitest)
npm run test:e2e  # Playwright e2e (public smoke + seeded lifecycle; see e2e/README.md)
npm run build     # also generates Next's PageProps types

npm run doctor       # 流程体检:静态接线 + 实时探针(默认打 prod);见 docs/DOCTOR.md
npm run doctor:deep  # 追加全链路:领取→作答→提交→通过→payout→导出(需 Docker + .env.e2e)

# Self-contained Postgres dev stack (no Supabase; auth degrades gracefully):
docker compose up
docker compose exec app npm run db:push
npm run seed:finals-demo
```

Test fixtures: `finals-fixtures.test.ts` reads the official datasets from
`./tmp-data` at the repo root — make sure it contains
`tmp-data/datasets/{qa_quality,preference_compare}/…` (unzip the course
test-data archive there) before running that test.

Useful flags: `LABELHUB_FOCUS_MODE` (default on — hides gateway entry points;
see `ARCHITECTURE.md` §5).
