# AI Review Agent — Architecture & Operations

LabelHub's **AI Review Agent** is the spec-4.4 auto-triage layer. Every annotation submit triggers a non-blocking background Claude call; the verdict is structured (Function Calling shape), idempotent, and audited end-to-end.

This doc explains the moving parts so a judge / on-call can answer "what happens between submit and reviewer queue?" without reading the source.

## Lifecycle in 6 steps

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Labeler hits Submit                                           │
│    submitAnnotation() at src/lib/actions/annotations.ts          │
│      • validates payload                                          │
│      • topic.status: drafting → submitted                         │
│      • writeRevision(kind='submit')                               │
│      • returns to client (latency: ≈request RTT only)             │
│                                                                  │
│                  after(() ⇣ Vercel post-response window)         │
│                                                                  │
│ 2. scheduleAIReviewIfMissing({annotationId})                     │
│    src/lib/actions/ai-review-submission.ts                       │
│      • JOIN annotations → topics → tasks                          │
│      • reads tasks.template_config.aiAgent.{enabled, prompt,     │
│        dimensions, passAt, sendBackAt, tier}                     │
│      • defaults to enabled=true for custom-designer mode          │
│      • computes idempotency_key = sha256(annotation|judge|ver)   │
│      • INSERT ai_submission_verdicts ... ON CONFLICT DO NOTHING  │
│      • emits event ai_review.started                              │
│      • topic.status: submitted → ai_review                        │
│                                                                  │
│ 3. assertWithinDailyAIQuota(submitterId)                         │
│      • throws QuotaExceededError → row.status='failed', return    │
│      • cost attributed to submitter, not workspace owner          │
│                                                                  │
│ 4. runReviewAgentWithRetry({prompt, dimensions, submission,...}) │
│    src/lib/ai/review-agent.ts                                    │
│      • chat() with responseFormat='json_object', tier='fast'      │
│      • 3 attempts, exponential backoff 1s/4s/16s                  │
│      • strict Zod-validated response shape:                       │
│          { verdict: pass|send_back|human_review,                 │
│            score: 0-100,                                         │
│            dimensions: Record<id, 0-100>,                        │
│            reasoning: string }                                   │
│      • threshold override — if model picks the wrong polarity     │
│        for its score, verdict is corrected to match passAt /     │
│        sendBackAt thresholds                                     │
│                                                                  │
│ 5. Verdict routing (D9):                                         │
│      pass         → topic.status=reviewing  + completed event    │
│      send_back    → topic.status=drafting   + sent_back event +  │
│                     writeRevision(kind='ai_send_back')           │
│      human_review → topic.status=reviewing  + completed event +  │
│                     verdict.scores.__priority=true                │
│      failure      → topic rolled back to submitted + failed event│
│                                                                  │
│ 6. Notification fan-out (D13):                                   │
│      send_back   → inbox 'ai_review.sent_back' to submitter       │
│      human_review→ inbox 'ai_review.escalated' to submitter       │
│      pass        → silent (no spam on success)                    │
│      failure     → audit log only (admin sees, labeler doesn't)   │
└──────────────────────────────────────────────────────────────────┘
```

## Function Calling shape

The model is steered with a tagged system prompt (full text in `src/lib/ai/review-agent.ts:SYSTEM_PROMPT_INTRO`) plus a user message that wraps the inputs in `<owner_prompt>`, `<dimensions>`, `<context>`, `<submission>`, `<thresholds>` tags. Tag contents are treated as data, not instructions — a defense against prompt injection inside annotation payloads.

The model is asked to return **JSON only**, validated against this Zod schema:

```ts
z.object({
  verdict: z.enum(['pass', 'send_back', 'human_review']),
  score: z.number().min(0).max(100),
  dimensions: z.record(z.string(), z.number().min(0).max(100)).default({}),
  reasoning: z.string().min(1).max(2000),
})
```

`chat()` is called with `responseFormat: 'json_object'`. Anthropic doesn't have a native JSON mode, so the system prompt's "OUTPUT FORMAT — strict JSON, NOTHING else" instruction is the actual enforcement; the response is then `stripCodeFences` + `JSON.parse`'d. A non-JSON response throws and the retry policy kicks in.

## Idempotency

`idempotency_key = sha256(annotationId|judgeId|schemaVersion)` is a UNIQUE column on `ai_submission_verdicts`. Two consequences:

1. **Re-submits don't double-spend**: if the labeler hits Submit twice (network double-click, race condition), the second `scheduleAIReviewIfMissing` runs but the INSERT is a no-op (ON CONFLICT DO NOTHING returns 0 rows), and the function returns early.
2. **Owner-driven re-runs are explicit**: when the owner changes the prompt or dimensions, they call `deleteVerdictForRerun(annotationId)` (also at `ai-review-submission.ts`). The next submit will compute a different key because the config changed.

## Retry policy

Inside `runReviewAgentWithRetry`:
- 3 attempts maximum
- Backoff: 1s, 4s, 16s (base × 4^i)
- A transient `chat()` failure (rate-limit, network blip) consumes one attempt; a Zod-invalid response also consumes one attempt (the next try might return valid JSON)
- On exhaustion, the last error message lands in `ai_submission_verdicts.error_text` and `ai_review.failed` is emitted

## Quota gate

`assertWithinDailyAIQuota(submitterId)` (existing helper at `src/lib/ai/quota.ts`) runs **before** the LLM call. Attribution is on the submitter so a heavy labeler hits their own cap, not the workspace owner's:

```ts
SELECT COUNT(*) FROM ai_call_log
WHERE user_id = $submitter AND ts > now() - interval '24 hours'
```

Default cap: `AI_DAILY_LIMIT_PER_USER` env var (defaults to 100). Quota-exhausted = verdict row `status='failed'` with `error_text='Daily AI quota reached (100/100). Resets in 24h.'`.

After a successful run, `logAICall({userId, feature: 'ai-review-agent', model, inputTokens, outputTokens, workspaceId})` records the cost. Cost-log failure is **non-fatal** — the verdict still persists; the daily budget dashboard catches the gap.

## Threshold logic

`passAt` and `sendBackAt` are integer percentages on `[0, 100]` configured per task at `/workspaces/[id]/tasks/[taskId]/ai-agent`. Constraint: `sendBackAt < passAt`. The routing rule:

```
score >= passAt    → pass
score <= sendBackAt → send_back
otherwise          → human_review
```

The model is told the thresholds upfront and asked to pick a matching verdict, but smaller / older models sometimes reverse the polarity. The route enforces — if `model.verdict` contradicts `model.score`, the score-driven decision wins.

## Audit trail

Each AI agent move emits one `events` row + may write to `annotation_revisions`. The audit timeline (`src/components/quality/annotation-audit-timeline.tsx`) renders `ai_review.*` events with a distinct violet palette so reviewers see AI moves at a glance:

| Event type | Emitted when | Audit-timeline label |
|---|---|---|
| `ai_review.started` | pending row inserted, topic → ai_review | "AI review started" (🪄) |
| `ai_review.completed` | pass / human_review verdict landed | "AI verdict" (✓) |
| `ai_review.sent_back` | send_back verdict landed | "AI sent back" (↻) |
| `ai_review.failed` | retries exhausted | "AI failed" (⚠) |

`writeRevision(kind='ai_send_back')` runs on the send-back path so the revision history shows the pre-send-back snapshot the labeler is being asked to fix.

## Owner-side config

The config UI lives at `/workspaces/[id]/tasks/[taskId]/ai-agent` (admin-only, 404 to everyone else). Settings:

- **Enabled** — master toggle. Off skips the after-hook entirely; defaults to ON for custom-designer mode, OFF for the three baked-in modes (`pair-rubric`, `arena-gsb`, `agent-trace-eval`).
- **Prompt template** — owner's review rubric. Sits inside `<owner_prompt>` in the user message. ~tokens estimate badge nudges away from runaway prompts.
- **Tier** — `fast` (Haiku) / `default` (Sonnet) / `premium` (Opus). Haiku covers ≈95% of cases at 1/30 the cost.
- **Pass-at / Send-back-at** — verdict thresholds; Zod refine enforces `sendBackAt < passAt`.
- **Scoring dimensions** — up to 10 `{id, name, description?}` rows. The agent returns a 0-100 per dimension; the UI shows them as a one-column table on the review page.

## Permissions

- Read AND write require `requireWorkspaceAdmin` — the Prompt blob can encode proprietary review criteria so even reads are gated.
- The scheduler itself runs as the `'ai'` actor in the state-machine (no user row); transitions to `ai_review`, `reviewing`, `drafting`, `submitted` are role-gated to that actor.
- The notification rows attribute `actorId=null`, which the inbox UI renders as "AI agent".

## File pointers

| File | Role |
|---|---|
| `src/lib/actions/ai-review-submission.ts` | Scheduler + verdict persistence + routing |
| `src/lib/actions/ai-review-keys.ts` | Pure `idempotencyKey()` helper |
| `src/lib/ai/review-agent.ts` | Function Calling wrapper + retry + threshold enforcement |
| `src/lib/ai/quota.ts` | `assertWithinDailyAIQuota` + `logAICall` |
| `src/lib/actions/ai-agent-config.ts` | Owner CRUD for per-task config |
| `src/lib/actions/ai-agent-config-schema.ts` | Zod schema + defaults (pure, importable client-side) |
| `src/components/ai-agent/agent-config-form.tsx` | Editor UI |
| `src/app/workspaces/[id]/tasks/[taskId]/ai-agent/page.tsx` | Config page route |
| `src/lib/db/schema.ts:aiSubmissionVerdicts` | Drizzle table |
| `drizzle/0001_finals.sql` (applied D6) | Migration creating the table + idempotency unique index |
| `docs/ROLE_PERMISSIONS.md` | Per-surface auth contract |

## Failure modes a judge might inspect

| Symptom | What to check |
|---|---|
| Submit feels slow | The after() hook is non-blocking; check Vercel logs for `[ai-review]` warnings. Submit latency should be unchanged. |
| AI verdict never appears | Owner config has `aiAgent.enabled=false` OR the task's mode is non-custom-designer without an explicit opt-in. |
| Same verdict repeated | Idempotency working as designed — re-running scheduleAIReviewIfMissing is a no-op. To force re-run, owner clicks "Re-run" (calls `deleteVerdictForRerun`). |
| "Quota exhausted" message | Submitter's 24h cap hit. Lift via `AI_DAILY_LIMIT_PER_USER` env, or wait for the rolling window. |
| Verdict polarity flipped | Threshold-override logic rewrote `verdict` to match `score`. Look at the `score` field in the verdict row — that's the authoritative number. |
| Failed verdict with error_text | Three Claude calls failed in a row. Common causes: provider down (502s), output not JSON, rate limit. Topic rolled back to `submitted` so a human can still act. |
