# Judge tour — the five hero flows in one click-path

A skimmable walk-through of every LabelHub hero flow end-to-end on a fresh
seed. Read `ARCHITECTURE.md` for the layer contract (queries read-only,
actions `'use server'` + Zod + auth guard + events) and `ROADMAP.md` §M0 for
the acceptance bar this tour proves.

## 0. Seed + sign in

```bash
npm run seed:finals-demo
```

Seeds one workspace **"Finals Demo · Annotation Workbench"** (`custom-designer`
mode) with two open tasks pre-loaded with the official datasets:
**问答质量标注** (30 topics) and **偏好对比标注** (12 topics), each with the AI
review agent pre-configured and a `cash-per-item` reward.

- The seed does **not** create a Supabase Auth user. Sign up once via
  `/signup`, grab your real UUID, then re-run
  `SEED_FINALS_ADMIN_ID=<your-uuid> npm run seed:finals-demo` so the workspace
  pivots to your identity (you become its admin).
- Land on the workspace cockpit at `/workspaces/[id]` — the section tiles are
  your map. `[id]` below = this workspace's id.

---

## 1. Create a task + import topics

1. Go to **`/workspaces/[id]/tasks`** → click **New task**
   (→ `/workspaces/[id]/tasks/new`).
   - Expect: the create-task form. Name it, pick the **custom-designer**
     template, attach/auto-build a form schema, Create.
2. Open the new task at **`/workspaces/[id]/tasks/[taskId]`** → in the
   *Import, add, and preview topics* panel click **Import wizard**
   (→ `/admin/tasks/[taskId]/import`). Drop a JSONL/CSV/Excel file, map the
   columns, confirm.
   - Expect: imported rows appear as topics; the task's *imported items*
     count climbs. Publish once at least one topic exists.
   - (Shortcut for the demo: the two seeded tasks are already created +
     imported + open, so you can skip straight to flow 2.)

## 2. The trajectory loop — get a key / paste, then annotate

1. **`/workspaces/[id]/api`** (admin-only) → §API KEYS → click **+ New key**.
   - Expect: the full `lh_ws_…` key shown **once**. Copy it. The page also
     shows copy-paste curl / SDK snippets per provider (point a real agent at
     `/api/proxy/<provider>` to capture live), the SDK ingest endpoint, and
     recent-call logs.
2. **OR** skip the key: go to **`/workspaces/[id]/trajectories`** → click
   **+ Upload a trajectory**, paste a single trajectory JSON (canonical /
   Anthropic / OpenAI), then **Upload & annotate**.
   - Expect: a new `source=upload` row in the captured-trajectories list and a
     jump straight into its annotator.
3. (For any captured row) open the trajectory → **Annotate** (→
   `/workspaces/[id]/trajectories/[trajId]/annotate`).
   - Expect: the full-bleed trajectory inspector with the step timeline and the
     annotation panel. Mark steps / fill the rubric; autosave persists as you go.

## 3. AI pre-review + human review

1. A submission is first scored by the AI agent
   (`lib/actions/ai-review-submission.ts`). Each verdict is **pass /
   send_back / human_review** with a per-dimension score and the raw prompt
   trace stored in `aiSubmissionVerdicts`.
2. As reviewer/admin, open the queue at **`/review`** — note the stage tabs
   (全部 / 待初审 / 待终审) → pick an item (→ `/review/[id]`).
   - Expect: a stage stepper (提交 → AI 预审 → 初审 → 终审 → 入库) on top, and
     the AI verdict + dimension scores shown alongside the submission.
   - **Two-stage accept** (the default, spec §9.3): click **初审通过** (key Q)
     — the topic advances to `awaiting_acceptance` (待终审); then
     **终审通过·入库** (key A) — advances to `approved`. The state machine
     enforces the order server-side; admin is a QC superset, so one account
     can do both clicks. Batch ops follow the same two stages: a bulk approve
     on 待初审 rows is a bulk 初审; switch to the 待终审 tab and bulk approve
     again to land them.
   - **Send back**: click **打回修订**, add a reason, confirm — returns the
     topic to the labeler as `revising`. (Final approval is what funds the
     wallet in flow 4: an approved annotation accrues a payout line item.)
   - (Per-task opt-out: untick 「两段人工审核」 on the task-edit page to get
     the single-stage direct-accept flow.)

## 4. The payment loop — credit → balance → withdraw → approve → paid

1. **Admin credits an account.** **`/workspaces/[id]/billing`** (admin-only) →
   top **credit an account** card → pick a workspace member, enter an amount
   (major units) + currency, click **Credit**.
   - Expect: an inline success message *"Credited. New balance: …"* on the
     card — a positive `adjustment`
     ledger row lands and that member's wallet balance rises. Money is stored
     in integer **minor units** (e.g. cents/分; the card multiplies by 100).
2. **User sees the balance.** As that user, open **`/my/earnings`**.
   - Expect: a wallet card per (workspace × currency) showing the credited
     balance, plus contribution counts and the ledger.
3. **User requests a withdrawal.** On the wallet card click **withdraw →**,
   enter an amount, **request withdraw**.
   - Expect: an inline success message *"Withdrawal requested — … pending admin
     approval."* on the wallet card and a
     `requested` row under *Your withdrawal requests*.
4. **Admin approves, then marks paid.** Back on **`/workspaces/[id]/billing`**
   → *Withdrawal queue*:
   - Click **Approve** on the `requested` row — writes the negative (debit)
     ledger row, balance drops; status → `approved`. (A notification pings the
     user's `/my/inbox`.)
   - Click **Mark paid** on the approved row — stamps the payout reference;
     status → `paid`. The user sees `paid` on `/my/earnings`.

## 5. Export a dataset

1. On the task page **`/workspaces/[id]/tasks/[taskId]`** scroll to the
   **Export** builder → choose a format (**JSON / JSONL / CSV / Excel**) and
   download.
   - Expect: small exports stream directly from `/api/export/dataset`; large
     (>5MB) exports run as an async job.
2. Track large/async jobs at **`/admin/exports`**.
   - Expect: the cross-workspace export history with live status and
     short-lived download URLs.

---

### Acceptance (ROADMAP §M0)

Fresh seed → create task, annotate a trajectory, AI + human review,
credit → withdraw → approve → paid, export — each demoable with **zero dead
ends**.
