# LabelHub Core API — Reference

This is the human-readable companion to [`openapi.yaml`](./openapi.yaml). It
documents **two surfaces**:

1. The **HTTP route handlers** (`src/app/api/**`) — the machine-to-machine /
   download / operational edges. These are what `openapi.yaml` formally
   describes.
2. The **Server-Action RPC surface** (`'use server'` functions in
   `src/lib/actions/**`) — the *primary* write API of the platform. The browser
   UI invokes these directly; they are **not** HTTP endpoints and therefore are
   not in the OpenAPI file, but they are the real entry points for task
   management, annotation, review, export and payouts.

Read [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §3 first if you want the
layer contract that explains *why* mutations live in Server Actions and only
external/machine surfaces live in `/api/**`.

---

## 1. Authentication model

Server-side guards are the single source of truth. There are three independent
auth models:

### 1.1 Supabase user session (the UI + admin HTTP flows)

A cookie session from `@supabase/ssr`. Every Server Action and every
session-auth route resolves it through one of the guards in
`src/lib/auth/guards.ts`:

| Guard | Passes when | Returns |
|---|---|---|
| `requireUser()` | any signed-in user (mirrors the auth user into our `users` row) | `{ id, email }` |
| `optionalUser()` | always (null if unauthenticated) | `AuthUser \| null` |
| `requireWorkspaceMember(wsId)` | caller is admin / qc / annotator / viewer of the workspace | `{ user, workspace, role }` |
| `requireWorkspaceQC(wsId)` | caller is **admin or qc** | `{ user, workspace, role }` |
| `requireWorkspaceAdmin(wsId)` | caller is workspace **admin** (members row `role='admin'`, or legacy `workspaces.admin_id`) | `{ user, workspace, role:'admin' }` |

Roles are stratified: `admin ⊇ qc ⊇ annotator ⊇ viewer`. The actions always
resolve the target entity → its workspace **before** the guard, so a forged id
pointing at another workspace still hits that workspace's scoped check.

### 1.2 Workspace API key (machine-to-machine)

A bearer token minted per workspace. Only the **SHA-256 hash** is stored
(`workspace_api_keys.keyHash`); the plaintext is shown once at creation. The
**workspace is inferred from the key**, so API-key endpoints never take a
`workspaceId`. Authenticated by `authenticateApiKey()`
(`src/lib/auth/api-key.ts`), which accepts the token on any of:

```
Authorization: Bearer lh_ws_…      # OpenAI-compat / cURL standard
Authorization: lh_ws_…             # bare token
x-api-key: lh_ws_…                 # Anthropic SDK / Claude Code default
x-labelhub-api-key: lh_ws_…        # legacy explicit header
```

Two accepted prefixes: `lh_ws_*` (normal) and `lh_demo_*` (the rate-limited
public demo key — treated identically by the gate). Revoked/expired keys fail
with `INVALID` / `EXPIRED`. Supporting `x-api-key` is deliberate: a stock
Anthropic harness can point `ANTHROPIC_BASE_URL` at the proxy and swap its key
for an `lh_ws_*` with no code change.

### 1.3 Admin ops token (`/api/admin/*`)

A single shared secret read from the `ADMIN_DIAG_TOKEN` env
(`src/lib/auth/admin-token.ts`). If the env is unset the route returns **503**
(no fallback — the old hardcoded fallback leaked into git history). Prefer
`Authorization: Bearer <token>` or `x-admin-token`; `?token=` is a
soft-deprecated fallback that logs a warning. Comparison is constant-time.

### 1.4 Public

`/api/health` and `/api/demo/info` take no auth and are IP-rate-limited
(`src/lib/ratelimit/public-endpoint.ts`).

---

## 2. Errors

Errors use a typed hierarchy (`src/lib/errors.ts`): `AppError` plus
`UnauthorizedError (401)`, `ForbiddenError (403)`, `NotFoundError (404)`,
`ValidationError (400)`, `QuotaExceededError (429)`, `ConflictError (409)`.

- **Server Actions** throw these; the client catches and switches on `.code`.
- **Route handlers** convert `.status` to the HTTP code. The JSON envelope
  differs by route family:
  - ingest / export / eval-run: `{ "error": "<msg>", "code": "<CODE>" }`
  - API-key reads + admin: `{ "error": { "message": "<msg>", "code": "<CODE>" } }`
  - gateway proxy: same nested shape + `"type": "labelhub_proxy"`
- Internal failures are **never** echoed: the stack/DB text is logged
  server-side and the client gets a generic `code: "INTERNAL"`, status 500.

Every authenticated edge writes an `api_request_log` row (success and failure)
for audit.

---

## 3. HTTP routes (`src/app/api/**`)

The formal contract is in [`openapi.yaml`](./openapi.yaml). Summary table:

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/ingest/trajectories` | API key | SDK ingest of one trajectory (2 MB cap → 413). Returns 202. |
| `GET /api/trajectories` | API key | List captured trajectories (filters, paging). |
| `GET /api/trajectories/{id}` | API key | One trajectory + steps + tool providers (cross-workspace → 403). |
| `GET /api/annotations` | API key | List annotation results (filters, paging). |
| `GET /api/annotations/{id}` | API key | One annotation (404 hides cross-tenant existence). |
| `GET /api/quality/summary` | API key | Workspace quality roll-up (IAA, trust, calibration). |
| `GET /api/webhooks` | API key | List webhook subscriptions. |
| `POST /api/webhooks` | API key | Register a webhook; returns `secret` once. |
| `DELETE /api/webhooks/{id}` | API key | Revoke (soft-delete) a webhook. |
| `GET /api/export/dataset` | session (admin) | Export a frozen dataset version; large → 202 async job. |
| `GET /api/export/jobs/{id}` | session (admin) | Poll an async export job; mints download URL on completion. |
| `GET /api/export/trajectories` | session (admin) | JSONL export of trajectories + annotations (≤200/call). |
| `GET /api/workspaces/{id}/tasks/{taskId}/export` | session (admin) | Per-task annotation export (json/jsonl/csv/excel). |
| `POST /api/eval-runs` | session (admin) | Run a simulated agent; persist trajectories (500 KB cap). |
| `POST /api/form-uploads` | session (member, not viewer) | Multipart upload of Custom Designer file material (25 MB). |
| `POST /api/llm-assist` | session (any user) | Per-field / per-topic LLM assist (10/min/user + daily quota). |
| `GET /api/workspaces/{id}/recent-events` | session (member) | Poll recent workspace events (live-activity strip). |
| `POST /api/proxy/{kind}/{...path}` | API key | LLM provider proxy with after()-window trajectory capture. |
| `GET /api/health` | public | Liveness + DB latency (detail fields gated by `HEALTH_DETAILED_TOKEN`). |
| `GET /api/demo/info` | public | Demo workspace's published API key + proxy base. |
| `GET /api/admin/diag` | admin token | Env-presence diagnostic (never leaks values). |
| `POST,GET /api/admin/compute-hints` | admin token | Synchronously compute trajectory hints. |
| `POST /api/admin/backfill-summaries` | admin token | Batch backfill trajectory summaries. |

### 3.1 Notable behaviors

- **Ingest** auto-detects the trajectory format (canonical / OpenAI chat /
  Anthropic messages); override with `X-LabelHub-Format`. `X-LabelHub-Agent-Name`
  and `X-LabelHub-Source` headers tag the capture.
- **Export — dataset vs task vs trajectories.** `/api/export/dataset` serves a
  *frozen dataset version* (immutable manifest) with a `raw`/`teaching` content
  shape and `json`/`jsonl`/`csv`/`excel` encoding; >5 MB estimated work
  enqueues an `export_jobs` row and returns 202 + a `statusUrl`. The per-task
  route serves live submitted annotations (incl. AI-review fields + trajectory
  step annotations). `/api/export/trajectories` is the JSONL bulk dump.
- **Proxy** requires `model` + a non-empty `messages` array. It forwards to the
  registered provider's `baseUrl/<path>`, applies per-connection + per-key RPM
  limits (default floor 60/min), optionally injects a topic-scope system prompt,
  streams or buffers the response, and persists the round-trip as a trajectory
  *after* the response is sent. Non-2xx upstreams pass through without capture.
- **Webhooks** deliver with `X-LabelHub-Signature = HMAC-SHA256(secret, body)`
  and `X-LabelHub-Event`; 5 s timeout, no retries, 10 consecutive failures
  auto-disable. Subscribable events: `annotation.{approved,rejected,revised,submitted}`.

### 3.2 cURL examples

```bash
# Ingest a trajectory (API key)
curl -X POST https://aipert.top/api/ingest/trajectories \
  -H "Authorization: Bearer lh_ws_…" \
  -H "X-LabelHub-Agent-Name: my-agent" \
  -H "Content-Type: application/json" \
  -d '{ "messages": [ … ] }'

# Read annotation results (API key)
curl "https://aipert.top/api/annotations?status=approved&limit=50" \
  -H "x-api-key: lh_ws_…"

# Use the proxy as a drop-in Anthropic base URL (API key)
curl -X POST https://aipert.top/api/proxy/anthropic/v1/messages \
  -H "x-api-key: lh_ws_…" \
  -H "Content-Type: application/json" \
  -d '{ "model": "claude-…", "messages": [ … ] }'

# Export one task's annotations as Excel (browser/admin session cookie)
curl "https://aipert.top/api/workspaces/<wsId>/tasks/<taskId>/export?format=excel" \
  -b "sb-…=<session-cookie>" -OJ

# Health (public)
curl https://aipert.top/api/health
```

---

## 4. Server-Action RPC surface (`src/lib/actions/**`)

These are the **primary write API**. They are `'use server'` async functions
the React app calls directly (Next.js serializes the call over the framework's
action transport); they are **not** addressable as REST endpoints. Each
validates input with **Zod**, calls an auth guard, mutates with optimistic
concurrency (`UPDATE … WHERE version = ?`), appends an **event**, and
`revalidatePath`s affected pages.

The signatures below are accurate to the code (input is the Zod-parsed object).

### 4.1 Task lifecycle — `src/lib/actions/tasks.ts`

All task actions are **workspace-admin** only.

| Action | Input | Auth | Effect | Returns |
|---|---|---|---|---|
| `createTask` | `{ workspaceId, name, description?, guidelinesMarkdown?, templateMode, rewardConfig, templateConfig?, phase=1, deadline? }` | `requireWorkspaceAdmin(workspaceId)` | Inserts a `draft` task. Enforces `task.templateMode === workspace.templateMode`; validates `templateConfig` per mode (`custom-designer` requires a `formSchemaId` resolving to a form in this workspace; baked modes reject it). Emits `task.created`; fire-and-forget topic-scope bootstrap. | the new task row |
| `publishTask` | `{ taskId }` | admin (resolved from task) | `draft → open`. Rejects if no topics imported yet. Emits `task.published`. | `{ ok: true }` |
| `pauseTask` | `{ taskId }` | admin | `open → paused`. Emits `task.paused`. | `{ ok: true }` |
| `resumeTask` | `{ taskId }` | admin | `paused → open`. Emits `task.resumed`. | `{ ok: true }` |
| `closeTask` | `{ taskId }` | admin | `open\|paused → closed`. Emits `task.closed`. | `{ ok: true }` |
| `archiveTask` | `{ taskId }` | admin | `draft\|open\|paused\|closed → archived`. Emits `task.archived`. | `{ ok: true }` |

`templateMode ∈ { custom-designer, pair-rubric, arena-gsb, agent-trace-eval }`.
Illegal transitions throw `ConflictError`.

### 4.2 Annotation work loop — `src/lib/actions/annotations.ts`

| Action | Input | Auth | Effect | Returns |
|---|---|---|---|---|
| `saveDraftAnnotation` | `{ topicId, payload, claudeProposal?, reasoningText? }` | `requireWorkspaceMember` (resolved topic→task→workspace); must be the topic's claimer | Upserts the draft (one row per topic×user). Auto-claims an unassigned topic via a version-CAS guard (loser gets `ForbiddenError`). Suspended raters can't claim new topics. Payload capped at 64 KB. Emits `annotation.drafted`; snapshots a rolling autosave revision. | the annotation row |
| `submitAnnotation` | `{ topicId, payload, claudeProposal?, deltaSummary?, reasoningText? }` | `requireWorkspaceMember`; topic claimer | **Strictly validates** payload against the template's `responseSchema` (and the Custom Designer form schema for `custom-designer`). Transitions `topic: drafting\|revising → submitted` under optimistic lock. Derives time-on-task. Emits `annotation.submitted`; writes a permanent `submit` revision; schedules the **AI review agent** in the after()-window. | the annotation row |
| `reviewAnnotation` | `{ annotationId, decision: approve\|reject\|request_revision, feedback? }` | `requireWorkspaceAdmin` (resolved annotation→topic→task→workspace) | The **final acceptance** step. From `submitted\|reviewing\|awaiting_acceptance`: `approve → approved` (terminal; funds payout via `approveAnnotation`, scans invite reward), `reject → rejected`, `request_revision → revising`. Optimistic lock. Emits `annotation.{approved,rejected,revised}`; notifies submitter; fans out webhooks + recomputes trust in after(). `feedback` required for `request_revision`. | `{ ok: true }` |
| `respondToReview` | `{ annotationId, message }` | `requireUser`; must be the original submitter | Appends an `annotation.review_replied` event (chat-style thread) and pings the most recent reviewer. | `{ ok: true, eventId }` |

### 4.3 QC review — `src/lib/actions/qc-review.ts`

| Action | Input | Auth | Effect | Returns |
|---|---|---|---|---|
| `qcReviewAnnotation` | `{ annotationId, decision: pass\|request_revision, feedback? }` | `requireWorkspaceQC` (admin or qc) | The intermediate quality-check between submit and admin acceptance. Delegates legality to the canonical state machine (`src/lib/quality/state-machine.ts`): `pass → awaiting_acceptance` (emits `annotation.qc_passed`), `request_revision → revising` (打回; emits `annotation.revised` tagged with `reviewerRole`). Blocks self-QC. Optimistic lock; notifies submitter; webhooks + trust recompute in after(). QC **cannot** terminally reject — that authority stays with admin. | `{ ok: true, next }` |

### 4.4 AI review agent (scheduler) — `src/lib/actions/ai-review-submission.ts`

| Action | Input | Auth | Effect | Returns |
|---|---|---|---|---|
| `scheduleAIReviewIfMissing` | `{ annotationId }` | none directly — invoked from `submitAnnotation`'s after()-hook (server-internal) | Idempotent (UNIQUE idempotency key on `ai_submission_verdicts`). If no verdict exists for the current agent-config fingerprint, inserts a `pending` row, runs the function-calling Claude review path (verdict `pass`/`send_back`/`human_review` + dimension scores + raw prompt trace), and writes the structured verdict back. Quota-checked against the submitter; never throws into the request path. | verdict result (internal) |

This action is not a customer-callable endpoint; it is the spec's "AI 审核 Agent"
(§4.4) wired into the submit transition.

### 4.5 Export — `src/lib/actions/export.ts`

| Function | Input | Auth | Effect | Returns |
|---|---|---|---|---|
| `generateJsonlExport` | `{ workspaceId, limit?=100 (≤200), createdBefore?, sources?, includeDeleted? }` | none (assumes caller authorized) — used by the route handler and the wrapper below | Builds a JSONL string of self-contained trajectory bundles (trajectory + steps + tool providers + topic + annotations + step annotations). Validates rows before emitting. | `{ jsonl, count }` |
| `exportTrajectoriesJsonl` | same `ExportOpts` | `requireWorkspaceAdmin(workspaceId)` | Auth + audit wrapper around `generateJsonlExport`; emits `export.created`. | `{ jsonl, count }` |

(The HTTP `/api/export/*` routes are the streaming/async equivalents; see §3.)

### 4.6 Billing / payouts — `src/lib/actions/billing/**`

No real payment rail is involved — these drive a ledger-backed demo economy.
The wallet balance is a rebuilt snapshot over an append-only `transactions`
ledger.

| Action | Input | Auth | Effect | Returns |
|---|---|---|---|---|
| `requestWithdraw` (`withdraw.ts`) | `{ workspaceId, paymentMethodId?, amountMinor, currency }` | `requireWorkspaceMember`; **viewer rejected** | Files a `withdrawal_requests` row in `status='requested'`. Checks balance ≥ amount, `MIN_WITHDRAW_MINOR ≤ amount ≤ MAX_WITHDRAW_MINOR`, one pending request per (user, ws, currency). **Balance is NOT debited here.** Emits `wallet.withdraw_requested`. | `{ ok, withdrawalRequestId, status:'requested', amountMinor, currency }` |
| `adminCreditAccount` (`admin-credit.ts`) | `{ workspaceId, userId, amountMinor, currency, memo? }` | `requireWorkspaceAdmin(workspaceId)` | "Money-in" side: appends one positive `adjustment` transaction for a member of *this* workspace, rebuilds the wallet snapshot. Emits `wallet.credited`; pings the credited user. | `{ ok, transactionId, newBalanceMinor }` |
| `reviewWithdrawal` (`review-withdrawal.ts`) | `{ requestId, decision: approve\|reject, memo? }` | `requireWorkspaceAdmin` (workspace resolved from the request row) | "Money-out": on `approve`, re-checks balance, appends a **negative** `withdraw` transaction (the debit lands *here*, not at request time), rebuilds the wallet, flips `requested → approved`; on `reject`, flips to `rejected` with no ledger row (balance untouched). Emits `withdrawal.{approved,rejected}`; pings the user. | approve: `{ ok, status:'approved', transactionId, newBalanceMinor }`; reject: `{ ok, status:'rejected' }` |
| `markWithdrawalPaid` (`review-withdrawal.ts`) | `{ requestId, externalRef? }` | `requireWorkspaceAdmin` | Flips `approved → paid` with a synthetic receipt (no real rail). Emits `withdrawal.paid`. | `{ ok, status:'paid', externalRef }` |

> **Note on layering.** `actions/annotations.ts` calls `lib/billing`
> (invite-reward + payout accrual on approval) — the one intentional core→gateway
> crossing, tracked in `ARCHITECTURE.md` §9/§11.3.

---

## 5. Common invariants

- **Optimistic concurrency** via a row `version` column on topics/annotations:
  `UPDATE … WHERE id = ? AND version = ?`, then bump; zero affected rows →
  `ConflictError` ("refresh and try again").
- **Events are the audit trail.** Every mutation appends to `events`; the
  projector (`src/lib/events/projector.ts`) folds them into replay-safe derived
  state (trust, IAA, learning curves).
- **Side effects run after the response** (`after()`): AI review scheduling,
  webhook fan-out, trust recompute, payout accrual — so the user-facing action
  stays snappy and a slow downstream never blocks the verdict commit.
- **Payload byte budgets** are enforced before persistence (64 KB annotation,
  2 MB ingest, 500 KB eval-run, 32 KB llm-assist, 25 MB upload).
