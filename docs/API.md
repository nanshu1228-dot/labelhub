# LabelHub HTTP API

Public-facing endpoints exposed under `/api/*`. Every endpoint enforces auth at the top of the handler; cross-tenant boundary checks happen against the resolved resource's `workspace_id` (see `docs/ROLE_PERMISSIONS.md` for the per-action role matrix).

Conventions:
- All endpoints accept and return JSON unless marked otherwise.
- Errors come back as `{ error: string, code?: string }` with the corresponding HTTP status.
- Auth: cookie-based Supabase session; the `requireUser` / `requireWorkspaceMember` / `requireWorkspaceAdmin` / `requireWorkspaceQC` guards live at `src/lib/auth/guards.ts`.
- Rate limits: per-key RPM on the proxy, per-user 10/min on `/api/llm-assist`, per-IP 30/min on the unauth public endpoints.

## Annotation surface

### `POST /api/annotations`
Submit or save a draft annotation. Body Zod-validated; payload byte cap 64KB.

| Field | Required | Notes |
|---|---|---|
| `topicId` | yes | UUID; topic must be assigned to the caller (auto-claimed on first save). |
| `kind` | yes | `'draft'` or `'submit'`. |
| `payload` | yes | Template-specific shape (validated against `template.responseSchema`). |

`kind='submit'` triggers the AI Review Agent after-hook (see `docs/AI_AGENT.md`). 200 returns `{ annotationId }`.

Auth: `requireWorkspaceMember` on the topic's workspace.

### `GET /api/annotations/[id]`
Fetch one annotation by id. Returns the annotation row + topic + task summary. Read access is workspace-member-wide; PII (annotator email) is omitted unless the caller is QC/admin.

## Dataset versions

### `GET /api/export/dataset?versionId=…&format=raw|teaching&encoding=jsonl|json|csv|excel`
Download a frozen manifest. Two orthogonal controls:

| Param | Default | Values | Effect |
|---|---|---|---|
| `versionId` | (required) | UUID | Which frozen dataset version to export. |
| `format` | `raw` | `raw` \| `teaching` | Content shape — `raw` is verbatim manifest entries; `teaching` reshapes to (prompt, ai_proposal, human_correction, delta) for SFT/DPO pipelines. |
| `encoding` | `jsonl` | `jsonl` \| `json` \| `csv` \| `excel` | Output file format. See `src/lib/export/formatters/` for the formatter modules. |

Response headers: `Content-Type` matches the encoding's MIME, `Content-Disposition: attachment; filename="labelhub-<ws>-<label>.<ext>"`, `x-export-count`, `x-version-label`, `x-format`, `x-encoding`.

Auth: `requireWorkspaceAdmin` on the version's workspace.

Audit event: `dataset.version_exported` (with format + encoding + bytes + itemCount payload).

### `GET /api/workspaces/[id]/tasks/[taskId]/export`
Per-task export of approved annotations. Same encoding parameter as `/api/export/dataset` once the route is upgraded to read from the formatter registry (the underlying topic→annotation→payload projection is identical).

## Trajectory ingest + read

### `POST /api/ingest/trajectories`
SDK upload path for full agent traces. Body is JSON with `trajectory: TrajectoryUploadShape`. Authenticated with the workspace's API key (`Authorization: Bearer lh_…`).

### `GET /api/trajectories/[id]` / `GET /api/trajectories?taskId=…`
Read trajectories — workspace-member auth.

### `GET /api/export/trajectories?taskId=…&format=jsonl`
Bulk export — workspace-admin auth.

## Proxy surface (Annotation-Aware LLM Gateway)

### `ANY /api/proxy/[kind]/[...path]`
The thesis-differentiator endpoint from prelims. `kind` is the provider (`anthropic` / `openai` / `doubao` / …); the path forwards verbatim to the provider after:
1. validating the workspace's API key
2. enforcing the topic-scope guardrail (if a `x-labelhub-topic-id` header is set)
3. recording an `events` row + an `api_request_log` row
4. teeing the response into the workspace's trajectory store

See `src/app/api/proxy/[kind]/[...path]/route.ts` + `src/lib/proxy/*` for the encoders / decoders / inject-scope helpers.

Auth: workspace API key in `Authorization: Bearer lh_…`. The bearer is hashed at rest and looked up via `apiKeys.tokenHash`.

## AI assist

### `POST /api/llm-assist`
Per-field Labeler AI assist — the Renderer's `llm-trigger` material calls this. Body:

```json
{
  "promptTemplate": "Suggest an answer for the labeled field.",
  "context": { "<other-field-id>": "<value>" },
  "tier": "fast" | "default" | "premium",
  "itemData": { /* topic.itemData slice for richer context */ }
}
```

Response: `{ "text": "…the model's reply…", "usage": {model, inputTokens, outputTokens} }`.

Gates (in order):
1. `requireUser` → 401 on sign-in fail
2. `rateLimitPublic('user:<id>', 10)` → 429 + `Retry-After` header on hit
3. Body validation (Zod + 32KB size cap) → 400 / 413
4. `assertWithinDailyAIQuota` → 429 on hit
5. `chat()` upstream call → 502 on failure

`logAICall({feature: 'llm-assist'})` runs on success.

## Webhook surface

### `POST /api/webhooks` / `GET /api/webhooks` / `DELETE /api/webhooks/[id]`
Per-workspace webhook subscriptions. Events fanned out via `fanoutWebhook()` (in Vercel's `after()` window so they don't block the primary action). See `src/lib/webhooks/fanout.ts` for the retry + signing policy.

Auth: `requireWorkspaceAdmin`.

## Operational endpoints

### `GET /api/health`
Public unauth probe. Returns `{status, ts, uptimeMs, db.{latencyMs,ok}, proxy.providers, window5min.{totalRequests,errorRate,p95DurationMs}}`.

Used by uptime monitors and the `scripts/_prod-smoke.ts` CI smoke. Rate-limited 30/min per IP.

### `GET /api/demo/info`
Demo workspace bearer token. Public unauth so judges / graders can probe the prelims-era proxy thesis without signing up.

### `GET /api/admin/diag`
Admin-only diagnostic snapshot. `Authorization: Bearer <ADMIN_DIAG_TOKEN>` env-gated.

### `POST /api/admin/backfill-summaries` / `POST /api/admin/compute-hints`
Background recompute endpoints for batch operations.

## Recent-events feed

### `GET /api/workspaces/[id]/recent-events?limit=…`
SSE stream of the last N events for a workspace. Used by the admin dashboard live tail.

Auth: `requireWorkspaceMember`.

## Eval runs

### `POST /api/eval-runs` / `GET /api/eval-runs?taskId=…`
Spawn / list eval runs (LLM-as-judge sweeps).

Auth: `requireWorkspaceAdmin`.

## Quality summary

### `GET /api/quality/summary?taskId=…`
Per-task IAA + trust + Dawid-Skene summary. Read-only.

Auth: `requireWorkspaceMember`.

---

## Common error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Zod / shape check failed. Details under `details`. |
| `UNAUTHORIZED` | 401 | No session cookie. |
| `FORBIDDEN` | 403 | Session valid but role insufficient. |
| `NOT_FOUND` | 404 | Resource doesn't exist OR caller can't see it (we don't distinguish). |
| `CONFLICT` | 409 | Optimistic-lock failure (`Topic was modified concurrently`); illegal state-machine transition. |
| `QUOTA_EXCEEDED` | 429 | Daily AI quota hit. |
| `RATE_LIMIT_EXCEEDED` | 429 | Per-user / per-IP rate limit hit; `Retry-After` header set. |
| `INTERNAL` | 500 | Server-side error. Detail logged; client gets a generic message. |

## Curl examples

```bash
# Health check
curl -s https://labelhub-gamma.vercel.app/api/health | jq .status

# Export a dataset version as Excel
curl -sL "https://labelhub-gamma.vercel.app/api/export/dataset?versionId=<UUID>&encoding=excel" \
  -o dataset.xlsx \
  -b "<auth cookie>"

# LLM assist (signed-in cookie session)
curl -s https://labelhub-gamma.vercel.app/api/llm-assist \
  -H "content-type: application/json" \
  -b "<auth cookie>" \
  -d '{"promptTemplate":"Suggest an answer.","context":{},"tier":"fast"}'

# Proxy a Claude call (workspace API key)
curl -s https://labelhub-gamma.vercel.app/api/proxy/anthropic/v1/messages \
  -H "authorization: Bearer lh_…" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}'
```
