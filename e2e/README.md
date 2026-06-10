# End-to-end tests (Playwright)

Browser-level smoke + lifecycle tests, complementing the ~1050 Vitest unit/integration tests.

## Suites

| File | Needs | What it proves |
|---|---|---|
| `public-smoke.spec.ts` | a reachable URL only | app boots; landing / sign-in / docs / not-found render without server errors |
| `annotation-lifecycle.spec.ts` | running app + seeded DB + a test user | the three-role chain: owner cockpit → labeler queue → AI/human review → export |

## Run modes

**Against the live demo (no DB needed locally):**
```bash
E2E_BASE_URL=https://aipert.top npx playwright test public-smoke
```

**Locally / CI with a database:**
```bash
npm run build
# in another shell (or let Playwright's webServer start it):
npm run test:e2e
```
Leave `E2E_BASE_URL` unset and Playwright starts `npm run start` on `http://localhost:3000` itself.

**Validate the suite without browsers or a DB** (how it's checked on dev machines without Postgres):
```bash
npx playwright test --list
```
This parses and lists every spec without launching anything.

## Environment for the seeded lifecycle suite

`annotation-lifecycle.spec.ts` self-skips unless all three are set (so the suite stays green on a bare checkout):

| Var | Meaning |
|---|---|
| `E2E_ADMIN_EMAIL` | a password-capable test user (workspace admin) |
| `E2E_ADMIN_PASSWORD` | that user's password |
| `E2E_DEMO_WORKSPACE_ID` | the workspace id printed by `npm run seed:finals-demo` |

> Auth assumption: the lifecycle suite signs in via the email+password form. If
> your Supabase project is OAuth/magic-link only, inject a Playwright
> `storageState` from a session minted with the Supabase admin API in a
> `globalSetup` instead, and drop the form-fill in `beforeEach`.

## CI

`.github/workflows/e2e.yml` spins up a Postgres service, runs `db:push` +
`seed:finals-demo`, builds, installs the Chromium browser, and runs the full
suite; the HTML report is uploaded as an artifact. Supabase / AI / test-user
values come from repo secrets.
