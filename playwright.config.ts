import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright end-to-end config. Two run modes:
 *
 *  - REMOTE target (e.g. the live demo): set `E2E_BASE_URL=https://aipert.top`.
 *    No local server is started; the public smoke specs run against it as-is.
 *
 *  - CI / local with a DB: leave `E2E_BASE_URL` unset. Playwright starts the
 *    app (`npm run start`, after a `npm run build`) on http://localhost:3000
 *    and runs the full suite (the seeded lifecycle specs require a seeded DB +
 *    a password test user — see e2e/README.md; they self-skip otherwise).
 *
 * `npx playwright test --list` parses + lists every spec WITHOUT starting a
 * browser or the web server, so the suite is verifiable even on a machine with
 * no database (which is how it's validated locally here).
 */
const remoteBase = process.env.E2E_BASE_URL
const baseURL = remoteBase ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Only auto-start a local server when targeting localhost. Against a remote
  // E2E_BASE_URL we hit the already-running deployment (this is also how
  // `doctor --deep` runs: it sets E2E_BASE_URL to the live server + a smoke
  // workspace, so no local server is started).
  webServer: remoteBase
    ? undefined
    : {
        command: 'npm run start',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
