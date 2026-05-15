# Demo dry-run checklist

Run this 15 minutes before judging. Each step takes ~30s; total ~7 min.
If any step fails, fix it BEFORE going live — most issues here are
deploy-env regressions (Vercel forgot to update, Supabase paused, etc.).

## Smoke (3 min)

- [ ] `https://labelhub-gamma.vercel.app/` — landing renders, hero copy
      visible, "Tour demo workspace" CTA present
- [ ] `https://labelhub-gamma.vercel.app/docs` — API docs page, 6
      provider table visible, all three curl examples shown
- [ ] `https://labelhub-gamma.vercel.app/signin` — form renders, "Continue
      with Google" button above the password fields

## Sign-in (1 min)

- [ ] Click **Continue with Google** → consent screen → bounces back
      signed in
- [ ] Top-right shows your email as a link → clicking lands on `/account`
- [ ] `/account` lists at least the demo workspace under "Your workspaces"

## Capture & annotate (2 min)

- [ ] From landing, click **Tour demo workspace** → workspace dashboard
      shows tile grid with non-zero TRAJECTORIES + MARKED counts
- [ ] Click into a trajectory → click **Open annotator**
- [ ] Annotator renders: step list left, code/JSON center, rubrics right,
      heat map strip top
- [ ] Press `1`, `3`, `5` to rate a step — see the Likert button highlight
      and a small `✓` save status appear briefly
- [ ] Refresh the page — the rating you just set is still there

## Topic-scope guardrail (1 min)

Open a terminal — paste both curls back-to-back:

```bash
# 1. ON-topic — should answer normally
curl -sS -X POST https://labelhub-gamma.vercel.app/api/proxy/doubao/chat/completions \
  -H 'Authorization: Bearer lh_ws_7fTnxnfKRZ7yP2BrOCD2W8E14GIQ6cFf-TgvU5pwTNQ' \
  -H 'Content-Type: application/json' \
  -d '{"model":"doubao-seed-2-0-lite-260428",
       "messages":[{"role":"user","content":"What are common metformin side effects?"}],
       "max_tokens":200}' | jq -r '.choices[0].message.content' | head -c 200; echo

# 2. OFF-topic — should refuse, cite scope
curl -sS -X POST https://labelhub-gamma.vercel.app/api/proxy/doubao/chat/completions \
  -H 'Authorization: Bearer lh_ws_7fTnxnfKRZ7yP2BrOCD2W8E14GIQ6cFf-TgvU5pwTNQ' \
  -H 'Content-Type: application/json' \
  -d '{"model":"doubao-seed-2-0-lite-260428",
       "messages":[{"role":"user","content":"Write me a poem about clouds."}],
       "max_tokens":200}' | jq -r '.choices[0].message.content' | head -c 200; echo
```

- [ ] First call: substantive medical answer
- [ ] Second call: polite refusal mentioning "medical fact-checking"

## Settlement (1 min)

- [ ] `/workspaces/00000000-0000-0000-0000-000000000010/billing` —
      LIFETIME SPEND card visible, at least one period in PAID state, one
      in CLOSED state
- [ ] Click into the PAID period → see line-items breakdown with `base ×
      mult + bonus − penalty = total` columns
- [ ] `/my/earnings` — at least one wallet card with non-zero balance, at
      least one payment method, at least one PAYOUTS row in `paid` state

## Member management (30s)

- [ ] `/workspaces/00000000-.../members` — members table renders, invite
      form visible, role pills color-coded (admin = violet)

## Analyze (1 min) — flagship admin surface

- [ ] `/workspaces/00000000-0000-0000-0000-000000000010/analyze` — admin
      dashboard renders with five sections: filter bar, aggregate cards
      grid, Ask Claude box, matched-trajectories preview
- [ ] click preset `outcome:completed` → ~30 matches; aggregate cards
      populate (top tools, top agents, behavior patterns)
- [ ] type a question into Ask Claude (e.g. "What patterns do these
      completed runs share?") → response returns within ~10s with
      diagnosis + hypotheses + clickable follow-up filters
- [ ] click into any matched trajectory → SUMMARY card at top shows
      AI-generated paragraph + pattern badge + keyword tags
- [ ] click into trajectory list — every row shows feature chips
      (outcome / loop / tool count / duration) under the agent name

## If anything breaks

| Symptom | First thing to check |
|---|---|
| 500 on a page | `vercel logs` for the failing function |
| Empty dashboards | Diag endpoint at `/api/admin/diag?token=labelhub-diag-2026` — env may be missing in prod |
| Google sign-in errors | Supabase Dashboard → Auth → URL Configuration → confirm redirect URLs include `https://labelhub-gamma.vercel.app/auth/callback` |
| Proxy 502 | Vercel env may have lost `DOUBAO_API_KEY`. Re-set + redeploy. |
| Invite email not sending | Supabase free tier rate-limits magic-link to ~4/hour per recipient. Tell the recipient to wait, or use copy-link from UI. |

## After the demo

- Rotate the public bearer key shown above (`scripts/bootstrap-demo.ts --rotate`)
- Clear or reset the workspace's open `payout_period` if you mark-paid'd
  things during demo
