import { test, expect } from '@playwright/test'

/**
 * Public-surface smoke — no auth, no seeded data. Runs against ANY reachable
 * instance (point at the live demo with `E2E_BASE_URL=https://aipert.top`).
 * Proves the app boots and its signed-out pages render without server errors —
 * the cheapest guard against a broken deploy.
 */
test.describe('public surfaces', () => {
  test('landing renders the LabelHub brand', async ({ page }) => {
    const resp = await page.goto('/')
    expect(resp?.ok()).toBeTruthy()
    await expect(page).toHaveTitle(/LabelHub/i)
    await expect(page.locator('body')).toContainText(/LabelHub/i)
  })

  test('sign-in page renders an auth surface', async ({ page }) => {
    const resp = await page.goto('/signin')
    expect(resp?.ok()).toBeTruthy()
    // Either the email form or the OAuth button must be interactive.
    await expect(page.locator('button, input').first()).toBeVisible()
  })

  test('docs page renders content', async ({ page }) => {
    const resp = await page.goto('/docs')
    expect(resp?.ok()).toBeTruthy()
    await expect(page.locator('body')).not.toBeEmpty()
  })

  test('unknown route returns the themed not-found (no crash)', async ({ page }) => {
    const resp = await page.goto('/this-route-does-not-exist-xyz')
    // Next renders not-found.tsx (HTTP 404) — the page must still paint, not error.
    expect([200, 404]).toContain(resp?.status())
    await expect(page.locator('body')).not.toBeEmpty()
  })
})
