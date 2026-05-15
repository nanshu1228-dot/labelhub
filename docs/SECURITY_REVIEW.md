# LabelHub security review — 2026-05-15

Triggered by user concern: "I'm worried that on the old labeling site
you could change the URL and see other people's data." We ran four
parallel audits (server actions, HTTP API, page-level IDOR, secrets/
config) and confirmed several real exploitable issues plus a handful
of defensible patterns. This document records what we found, what we
fixed, what remains, and the operational steps needed in prod.

---

## Threat model

| # | Attacker | Goal |
|---|----------|------|
| 1 | Signed-in user in workspace A | Read or write resources in workspace B |
| 2 | Annotator (not admin) in workspace A | Perform admin-only actions in A |
| 3 | Viewer (read-only role) in workspace A | Perform any mutation in A |
| 4 | Anonymous attacker with a URL | Hit any auth-gated page |
| 5 | Person who reads the repo / git history | Find hardcoded secrets to abuse |

---

## What we fixed in this pass

### Tier-1 IDOR — pages now require workspace membership

Nine pages used to render for **any signed-in user** (or in some cases
**any anonymous visitor**) who guessed the URL. Now every page below
calls `optionalUser()` → redirect to /signin if unauth, then
`requireWorkspaceMember` (or `requireWorkspaceAdmin` for admin-only
surfaces). Non-members get a generic `notFound()` — we deliberately
don't distinguish "doesn't exist" from "exists but not yours" so a
malicious tenant probe can't enumerate workspaces.

| Page | New gate |
|---|---|
| `/workspaces/[id]` (dashboard) | `requireWorkspaceMember` |
| `/workspaces/[id]/trajectories` (list) | `requireWorkspaceMember` |
| `/workspaces/[id]/trajectories/[trajId]` (detail) | `requireWorkspaceMember` |
| `/workspaces/[id]/trajectories/[trajId]/annotate` (annotator) | `requireWorkspaceMember` |
| `/workspaces/[id]/billing` | `requireWorkspaceAdmin` |
| `/workspaces/[id]/billing/[periodId]` | `requireWorkspaceAdmin` |
| `/workspaces/[id]/api` (API keys) | `requireWorkspaceAdmin` |
| `/workspaces/[id]/connections` (provider keys) | `requireWorkspaceAdmin` |
| `/workspaces/[id]/disputes` | `requireWorkspaceMember` |
| `/workspaces/[id]/eval-runs/new` | `requireWorkspaceMember` |

Pages that were already gated (`members`, `quality`, `analyze`,
`activity`, `settings`) confirmed safe.

### Tier-1 IDOR — server action

`step-annotations-demo.ts` was the biggest exposed hole:

- Hardcoded `DEMO_USER_ID = '00000000-0000-0000-0000-000000000001'`
  used as the actor for every write
- Gated only on `LABELHUB_DEMO_MODE=true` env — if that ever flipped
  on in prod (or attacker found a way), every write was attributed
  to the seed admin and crossed workspace lines silently

Fixed: removed `DEMO_USER_ID` and `assertDemoMode()`. Every export now
calls `requireWorkspaceMember(workspaceId)`, blocks viewers from
writes, scopes reads to the signed-in user. The file name kept the
`-demo` suffix to avoid breaking imports; behavior is now real auth.

### Tier-2 admin endpoints — hard token gate

Three routes (`/api/admin/diag`, `/api/admin/compute-hints`,
`/api/admin/backfill-summaries`) shared this pattern:

```ts
const ADMIN_TOKEN = process.env.ADMIN_DIAG_TOKEN ?? 'labelhub-diag-2026'
```

The fallback string lives in git history and was documented in
`DEMO_CHECKLIST.md`. Anyone who read the repo could probe env state,
trigger LLM cost, or run admin batch jobs.

Fixed:
- New `src/lib/auth/admin-token.ts` — central gate.
- `ADMIN_DIAG_TOKEN` env var is **required**; if unset, every admin
  route returns 503 (`ADMIN_DISABLED`).
- Comparison is constant-time (`timingSafeEqual` over char codes).
- No fallback string anywhere in the codebase.

### Tier-2 information disclosure

`/api/admin/compute-hints` used to return `e.message` AND the first 5
stack frames on internal failures. Stack traces leaked module paths
(`/src/lib/ai/...`), database constraint names, and Drizzle internals.

Fixed: caught errors now log full stack server-side (Vercel function
logs) and return a generic `{code: 'INTERNAL', message: 'Compute
failed. Check server logs.'}` to the caller. Code paths that produce
user-actionable errors (NotFound, validation) still surface a useful
message; only true 500s get sanitized.

---

## Verified safe (no change needed)

- **Workspace API key hashing**: SHA-256, plain key never persists.
  Stored only in `workspace_api_keys.key_hash`. Plain shown once on
  creation. Confirmed in `src/lib/auth/api-key.ts:35` +
  `scripts/bootstrap-demo.ts:54`.
- **No secrets in client bundles**: all `'use client'` files reference
  only `NEXT_PUBLIC_*` env vars. Verified by grep across 20+ client
  components.
- **No SQL injection**: Drizzle's `sql\`...${param}...\`` template
  consistently binds parameters. No `.execute()` / `.raw()` with
  user-controlled input found.
- **Prompt injection defense**: every LLM-facing surface
  (`trajectory-reviewer`, `guideline-refiner`, `trajectory-summarizer`,
  `batch-analyst`) wraps user input in XML tags + escapes via
  `escapeForPrompt`. System prompts explicitly state tag contents are
  data, not instructions.
- **CORS**: no `Access-Control-Allow-Origin: *` anywhere. Next.js
  default is same-origin.
- **Supabase session cookies**: HttpOnly + Secure + SameSite handled
  by `@supabase/ssr` middleware in `proxy.ts`. No custom cookie code
  bypasses these defaults.
- **Customer HTTP API** (`/api/annotations`, `/api/quality/summary`,
  `/api/webhooks`, `/api/trajectories`): every route resolves
  `authenticateApiKey(request)` and scopes every query to the
  bearer's workspace. Workspace boundary enforced at the query layer.

---

## Required operator step before deploy

Set `ADMIN_DIAG_TOKEN` in Vercel project env. **Suggested**: rotate
to a new random value rather than reusing `labelhub-diag-2026` from
the old docs.

```bash
# Generate a fresh token:
openssl rand -base64 32

# In Vercel dashboard → project → Settings → Environment Variables:
#   Name:  ADMIN_DIAG_TOKEN
#   Value: <paste>
#   Scope: Production (and Preview if you want admin access there)
```

After redeploy, update DEMO_CHECKLIST.md's troubleshooting entry to
point at the new token (currently hardcoded as `labelhub-diag-2026`
on line 94 — already updated to reference the env var pattern).

If `ADMIN_DIAG_TOKEN` is not set, admin routes return `503
{code:'ADMIN_DISABLED'}` — safe failure mode. Customer-facing routes
(`/api/proxy`, `/api/annotations`, etc.) are unaffected.

---

## Remaining lower-severity findings (deferred)

Recorded for future hardening; not exploitable on their own at the
current scale.

1. **`reviewAnnotation` resolves resources before auth** (annotations.ts:
   252-277). Loads annotation → topic → task before calling
   `requireWorkspaceAdmin`. An attacker can probe by ID to discover what
   exists in workspace B (timing/error signal). **Fix**: resolve
   workspaceId via `topics.taskId → tasks.workspaceId` first, then
   gate, then read. Minor — both error paths return the same 404 to
   the client.

2. **`openTrajectoryForAnnotation` has no membership gate**
   (inbox.ts). It's exported and called from elsewhere; the gate sits
   in the callers, not here. **Fix**: belt-and-braces — add
   `requireWorkspaceMember(opts.workspaceId)` at the top.

3. **`/api/trajectories` query params not Zod-validated**
   (route.ts:49-50). Drizzle's parameterization makes injection
   moot, but adding a Zod schema would tighten the boundary.

4. **No per-IP rate limiting on admin token attempts**. Brute-force
   is impractical against 256-bit random tokens but Vercel doesn't
   ship rate limiting by default. **Fix**: add Upstash-Redis-backed
   rate limit on `/api/admin/*` first-fail per IP per minute.

5. **`step-annotations-demo.ts` still exists with the `-demo` suffix**.
   Now real-auth, but the misleading name should be renamed when we
   touch the file again (every import needs to update).

---

## How to re-run the audit

1. **Pages**: `Grep "PageProps<'/workspaces/" src/app/` then for each
   match verify `optionalUser` + `requireWorkspaceMember/Admin` calls
   exist BEFORE any data read.
2. **Server actions**: `grep "'use server'" src/lib/actions/` then
   for each verify `requireUser/Member/Admin` is the first line of
   every export.
3. **API routes**: `grep "export async function POST\|GET\|DELETE"
   src/app/api/` then for each verify either `authenticateApiKey` or
   `checkAdminToken` runs first.
4. **Hardcoded secrets**: `grep -ER "(api_key|token|secret|password)
   *= *['\"][a-zA-Z0-9_-]{16,}" src/`. Audit anything that turns up.

Last full audit: 2026-05-15 by 4 parallel explorer agents.
