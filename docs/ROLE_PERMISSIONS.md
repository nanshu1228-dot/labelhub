# Role permissions — authoritative spec

LabelHub has 4 workspace roles, each a strict superset of the next:

```
admin   ⊃ qc ⊃ annotator ⊃ viewer
```

A user with role X can do everything role Y can, where Y is to the right of X above.

## The full matrix

✅ allowed · ❌ blocked · ⚙ allowed but the server action enforces additional checks (e.g. workspace boundary, self-action block)

| Capability | viewer | annotator | qc | admin |
|---|:-:|:-:|:-:|:-:|
| **Read** | | | | |
| View workspace dashboard | ✅ | ✅ | ✅ | ✅ |
| View trajectory list / detail | ✅ | ✅ | ✅ | ✅ |
| View my own marks | ✅ | ✅ | ✅ | ✅ |
| View peer marks (in disputes view) | ✅ | ✅ | ✅ | ✅ |
| View my contribution counts on /my/earnings | ✅ | ✅ | ✅ | ✅ |
| See another rater's trust score | ❌ | ❌ | ❌ | ✅ |
| See another rater's calibration | ❌ | ❌ | ❌ | ✅ |
| Read /quality dashboard | ❌ | ❌ | ❌ | ✅ |
| Read /analyze batch surface | ❌ | ❌ | ❌ | ✅ |
| Read /billing pages | ❌ | ❌ | ❌ | ✅ |
| Read /api keys page | ❌ | ❌ | ❌ | ✅ |
| Read /connections page | ❌ | ❌ | ❌ | ✅ |
| Read /members (roster) | ✅ | ✅ | ✅ | ✅ |
| **Annotate (write)** | | | | |
| `commitStepMark` | ❌ | ✅⚙ | ✅⚙ | ✅⚙ |
| `commitTrajectoryMark` | ❌ | ✅⚙ | ✅⚙ | ✅⚙ |
| `markStepInline` (legacy widget) | ❌ | ✅⚙ | ✅⚙ | ✅⚙ |
| `submitComparison` | ❌ | ✅⚙ | ✅⚙ | ✅⚙ |
| `respondToReview` (reply to my own review thread) | ❌ | ✅⚙ | ✅⚙ | ✅⚙ |
| **Quality check (qc)** | | | | |
| `qcReviewAnnotation` decision=`pass` | ❌ | ❌ | ✅⚙ | ✅⚙ |
| `qcReviewAnnotation` decision=`request_revision` (打回) | ❌ | ❌ | ✅⚙ | ✅⚙ |
| `promoteAnnotationToGold` | ❌ | ❌ | ❌ | ✅ |
| `unmarkGold` | ❌ | ❌ | ❌ | ✅ |
| **Acceptance (admin only)** | | | | |
| `reviewAnnotation` decision=`approve` | ❌ | ❌ | ❌ | ✅ |
| `reviewAnnotation` decision=`reject` | ❌ | ❌ | ❌ | ✅ |
| `reviewAnnotation` decision=`request_revision` | ❌ | ❌ | ❌ | ✅ |
| `approveAnnotation` (billing payout line item) | ❌ | ❌ | ❌ | ✅ |
| `closePayoutPeriod` | ❌ | ❌ | ❌ | ✅ |
| `markPayoutPaid` | ❌ | ❌ | ❌ | ✅ |
| **Self-financial** | | | | |
| `requestWithdraw` (my own balance) | ❌ | ✅⚙ | ✅⚙ | ✅⚙ |
| `addPaymentMethod` / `removePaymentMethod` (mine) | ✅ | ✅ | ✅ | ✅ |
| **Workspace management** | | | | |
| `createWorkspace` (you become admin) | ✅ | ✅ | ✅ | ✅ |
| `renameWorkspace` | ❌ | ❌ | ❌ | ✅ |
| `inviteToWorkspace` · `changeMemberRole` · `removeMember` | ❌ | ❌ | ❌ | ✅ |
| `addConnection` (LLM key) | ❌ | ❌ | ❌ | ✅ |
| Add / revoke API key | ❌ | ❌ | ❌ | ✅ |
| `regenerateWorkspaceScope` / `editWorkspaceScopeManually` | ❌ | ❌ | ❌ | ✅ |
| **Eval-runs** | | | | |
| Trigger `/api/eval-runs` | ❌ | ✅ | ✅ | ✅ |
| Refine guidelines via Claude | ❌ | ❌ | ❌ | ✅ |
| **Queue** | | | | |
| Appear in `/my/queue` workspace selector | ❌ | ✅ | ✅ | ✅ |
| `skipTrajectory` (personal) | ✅ | ✅ | ✅ | ✅ |

## Annotation state machine

```
                  annotator
drafting ─submit→ submitted
                     │
              ┌──────┴──────────────────┐
              │                         │
        qc / admin                   admin only
        picks up                     skips QC
              │                         │
              ▼                         ▼
          reviewing                approved | rejected
              │
       ┌──────┴─────────┐
       │                │
   qc pass         qc/admin 打回
       │                │
       ▼                ▼
awaiting_acceptance  revising
       │                │
       │                └──→ annotator picks back up → drafting
       │
       │ admin
       │ verdict
       ▼
   approved | rejected
```

## Action × source-state contract

`qcReviewAnnotation` — gate: `requireWorkspaceQC` (admin or qc)

| Source state | Allowed | Decision | Target state | Event |
|---|---|---|---|---|
| `submitted` | ✅ | `pass` | `awaiting_acceptance` | `annotation.qc_passed` |
| `submitted` | ✅ | `request_revision` | `revising` | `annotation.revised` |
| `reviewing` | ✅ | `pass` | `awaiting_acceptance` | `annotation.qc_passed` |
| `reviewing` | ✅ | `request_revision` | `revising` | `annotation.revised` |
| `awaiting_acceptance` / `drafting` / `revising` / `approved` / `rejected` | ❌ ConflictError | — | — | — |
| Self-QC (viewer is the submitter) | ❌ ConflictError | — | — | — |

`reviewAnnotation` — gate: `requireWorkspaceAdmin` only

| Source state | Allowed | Decision | Target state | Event |
|---|---|---|---|---|
| `submitted` | ✅ | `approve` | `approved` | `annotation.approved` |
| `submitted` | ✅ | `reject` | `rejected` | `annotation.rejected` |
| `submitted` | ✅ | `request_revision` | `revising` | `annotation.revised` |
| `reviewing` | ✅ | (same as submitted) | … | … |
| `awaiting_acceptance` | ✅ | (same as submitted) | … | … |
| `drafting` / `revising` / `approved` / `rejected` | ❌ ConflictError | — | — | — |

## Finals additions (P1 + P2 + P3)

### Custom Form Designer (4.2)
| Surface | Roles | Notes |
|---|---|---|
| `/admin/forms` (list) | admin only | 404 to non-admins; only workspaces this user admins are listed. |
| `/admin/forms/new` + `/admin/forms/[id]` (Designer) | admin only | Save targets one of the admin's workspaces. |
| `createCustomFormSchema` / `updateCustomFormSchema` / `archiveCustomFormSchema` | `requireWorkspaceAdmin` per save target | `custom_form_schemas` rows isolated by `workspace_id`. |
| `loadCustomFormSchema` | Any signed-in user | Renderer-side path; the consuming task's workspace gates the read upstream. |
| `/api/llm-assist` (Labeler AI assist) | `requireUser` + per-user rate limit (10/min) + daily AI quota | Body capped at 32KB; tier configurable per `llm-trigger` field. |

### AI Review Agent (4.4)
| Surface | Roles | Notes |
|---|---|---|
| `/workspaces/[id]/tasks/[taskId]/ai-agent` | admin only | 404 to non-admins; read AND write both guarded via `requireWorkspaceAdmin`. The Prompt blob can encode proprietary review criteria so even reads are gated. |
| `saveAiAgentConfig` / `getAiAgentConfig` | `requireWorkspaceAdmin(task.workspaceId)` | Zod validates `passAt > sendBackAt` and unique dimension ids. |
| `scheduleAIReviewIfMissing` (after-hook) | System (no actor) | Runs in Vercel's `after()` window; idempotent via `idempotency_key UNIQUE` index. Never throws to the caller. |
| `runReviewAgent` (Function Calling) | System | Honors per-user `assertWithinDailyAIQuota(submitterId)`. Quota-exhausted: verdict row flips to `status='failed'`. |

### Review workbench (4.5)
| Surface | Roles | Notes |
|---|---|---|
| `/review` (queue) | qc OR admin | 404 if user has neither role in any workspace. Cross-workspace queue is hard-isolated — the user's allowed workspace ids are computed on every request from `workspace_members` and used as an `inArray` filter. |
| `/review/[id]` (single view) | `requireWorkspaceQC(annotation.workspaceId)` | 404 if not qc/admin; 404 also if the resolved annotation doesn't exist (don't leak existence). |
| `batchReviewAnnotations` | Per-row `requireWorkspaceQC` via `qcReviewAnnotation` | Mixed-workspace batches OK — rows the caller can't QC end up in `failed`, the rest succeed. |
| `qcReviewAnnotation` | `requireWorkspaceQC` + state-machine `applyTransition()` | Self-QC blocked (submitter cannot QC their own work). State machine throws `IllegalTransitionError` when topic isn't `submitted` or `reviewing`. |

### Workflow state machine (D12)
| From | Action | Role(s) | To | Notes |
|---|---|---|---|---|
| `drafting` | `submit` | annotator | `ai_review` | After-hook schedules AI agent. |
| `drafting` | `skip_ai` | admin / ai | `submitted` | Used when `aiAgent.enabled=false`. |
| `revising` | `resubmit` | annotator | `ai_review` | Second-submit mirrors the first. |
| `ai_review` | `ai_pass` | ai | `reviewing` | Scheduler write only. |
| `ai_review` | `ai_send_back` | ai | `drafting` | + `writeRevision(kind='ai_send_back')`. |
| `ai_review` | `ai_human_review` | ai | `reviewing` | Verdict carries `__priority` flag. |
| `ai_review` | `ai_fail` | ai | `submitted` | Rollback so a human reviewer can still act. |
| `submitted` / `reviewing` | `qc_pass` | qc / admin | `awaiting_acceptance` | |
| `submitted` / `reviewing` | `qc_request_revision` | qc / admin | `revising` | |
| `submitted` / `reviewing` / `awaiting_acceptance` | `admin_accept` | admin | `approved` | Idempotent if already approved. |
| `submitted` / `reviewing` / `awaiting_acceptance` | `admin_reject` | admin | `rejected` | Idempotent if already rejected. |
| `awaiting_acceptance` | `qc_request_revision` | admin | `revising` | Late kickback after QC sign-off. |

`applyTransition()` from `src/lib/quality/state-machine.ts` is the single point of authority. Illegal moves throw `IllegalTransitionError`; role mismatches throw `ForbiddenRoleError`. Idempotency is **terminal-only** — re-approving an `approved` row is a benign no-op; re-running a mid-stream action throws so race bugs don't get masked.

## Cross-tenant boundary (every action)

Every action's first DB read resolves the target resource's `workspace_id`, then calls the role guard against THAT workspace. A signed-in user in workspace A who passes a resource id from workspace B gets:
- `ForbiddenError` from `requireWorkspaceMember/QC/Admin` (404 / 403 surfaced to client)
- Same uniform error regardless of "doesn't exist" vs "exists but wrong workspace" — don't leak existence.

## Trust-score signals (informational)

Only the FINAL `annotation.approved` event counts as a positive signal in `trust-projection`. `annotation.qc_passed` is the intermediate hop and is **not** double-counted toward trust. Same for `annotation.rejected` (negative signal); `annotation.revised` does not directly affect trust but creates audit history.

## Tests

The role boundary is enforced in three layers:
1. **Page-level access**: `optionalUser` + `requireWorkspaceMember/Admin` at the top of every page that touches workspace data (see `scripts/security-smoke-test.ts`).
2. **Server-action guards**: every export under `src/lib/actions/` calls a `require*` helper before any side effect (see `src/lib/auth/__tests__/role-guards.test.ts`).
3. **Action body**: cross-workspace boundary check after the guard, when the action takes a resource id (e.g. `gold.unmark`, `qcReviewAnnotation`).
