/**
 * Shared seed constants — single source of truth for hard-coded
 * demo / sentinel identifiers that show up across landing, auth,
 * onboarding tour, and account UIs.
 *
 * Adding a new constant here is preferable to inlining a UUID
 * fourth time in the codebase.
 */

/**
 * The public demo workspace (seeded by scripts/seed-demo.ts).
 * Carries the medical-fact-checking trajectories that the
 * landing's "Tour the public demo workspace" CTA drops the visitor
 * into, plus the rate-limited demo API key.
 *
 * Phase-17 17c: also referenced by `/api/demo/info` and the
 * onboarding tour overlay.
 */
export const DEMO_WORKSPACE_ID =
  '00000000-0000-0000-0000-000000000010'

/** Convenience: the user-facing URL for the demo workspace, used
 *  by landing/auth/nav CTAs. */
export const DEMO_WORKSPACE_PATH = `/workspaces/${DEMO_WORKSPACE_ID}`

/**
 * Sentinel admin user — the workspace creator seeded into demo /
 * test environments. Lets background jobs bill `aiCallLog` against
 * a known user when the triggering actor is unknown (e.g. system
 * cron). Avoid spreading new uses; prefer the actual triggering
 * user id when one is in scope.
 */
export const SENTINEL_ADMIN_USER_ID =
  '00000000-0000-0000-0000-000000000001'
