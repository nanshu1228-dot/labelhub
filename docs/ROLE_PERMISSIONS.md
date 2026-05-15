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
