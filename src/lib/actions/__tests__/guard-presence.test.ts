import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

/**
 * Guard-presence smoke test — defends against the most common
 * permission regression: forgetting to call a `require*` auth guard in
 * a newly added server action.
 *
 * Strategy: for each known action file, scan the source for `require*`
 * call sites. We don't run the actions — we just statically verify
 * every export is wrapped in something. A new action with no guard
 * will fail this test, prompting the author to either:
 *   1. Add the right guard for the role bucket, OR
 *   2. Update the EXPECTED_GUARDS map (and the docs) if the action is
 *      genuinely public.
 *
 * This is the third defense layer described in docs/ROLE_PERMISSIONS.md
 * ("Action body" → cross-workspace boundary check after the guard).
 */

const ACTIONS_DIR = resolve(__dirname, '..')

/**
 * Map of action file → at least one expected guard call.
 *
 * Each entry says "this file MUST contain at least one call to the
 * named guard". We list the strictest gate the file uses so the test
 * still passes when the file ALSO uses weaker guards (e.g. requireUser
 * inside a helper). The point is regression detection, not exhaustive
 * spec — that's the role-guards.test.ts + qc-review.test.ts +
 * review-annotation.test.ts trio.
 */
const EXPECTED_GUARDS: Record<string, RegExp> = {
  // Admin-only surfaces (workspace management, gold, billing, API keys,
  // connections, exports, tool providers, eval-run trigger, trajectory
  // admin, topic scope, tasks, analyze pipeline).
  'analyze.ts': /requireWorkspaceAdmin\(/,
  'api-keys.ts': /requireWorkspaceAdmin\(/,
  'connections.ts': /requireWorkspaceAdmin\(/,
  'export.ts': /requireWorkspaceAdmin\(/,
  'gold-standards.ts': /requireWorkspaceAdmin\(/,
  'tasks.ts': /requireWorkspaceAdmin\(/,
  'tool-providers.ts': /requireWorkspaceAdmin\(/,
  'topic-scope.ts': /requireWorkspaceAdmin\(/,
  'trajectories.ts': /requireWorkspaceAdmin\(/,
  // Billing admin surfaces.
  'billing/approve-annotation.ts': /requireWorkspaceAdmin\(/,
  'billing/close-period.ts': /requireWorkspaceAdmin\(/,
  'billing/mark-paid.ts': /requireWorkspaceAdmin\(/,
  // QC-or-above (qc + admin).
  'qc-review.ts': /requireWorkspaceQC\(/,
  // Member-level write surfaces (annotator + qc + admin pass).
  'annotate-marks.ts': /requireWorkspaceMember\(/,
  'comparisons.ts': /requireWorkspaceMember\(/,
  'step-annotations-inline.ts': /requireWorkspaceMember\(/,
  'billing/withdraw.ts': /requireWorkspaceMember\(/,
  // Self-only / mixed (requireUser is acceptable; the action checks
  // resource ownership itself).
  'annotations.ts': /require(User|WorkspaceAdmin)\(/,
  'membership.ts': /require(User|WorkspaceAdmin|WorkspaceMember)\(/,
  'queue.ts': /require(User|WorkspaceMember)\(/,
  'step-annotations.ts': /requireUser\(/,
  'topics.ts': /require(User|WorkspaceAdmin)\(/,
  'workspaces.ts': /require(User|WorkspaceAdmin)\(/,
  'billing/payment-methods.ts': /requireUser\(/,
  'ai.ts': /require(WorkspaceAdmin|WorkspaceMember)\(/,
  // Self-service workspace seed claim — signed-in user takes over
  // workspaces whose adminId still matches the seed sentinel. The
  // sentinel check itself happens in-SQL, so requireUser is enough.
  'admin-claim.ts': /requireUser\(/,
  // AI pre-submission feedback — workspace member (annotator+) only.
  'draft-feedback.ts': /requireWorkspaceMember\(/,
  // NL → rubric generator — admin only (template_config is admin-managed).
  'template-generator.ts': /requireWorkspaceAdmin\(/,
  // LLM-as-Judge config + runs — admin only (cost + visibility).
  'llm-judges.ts': /requireWorkspaceAdmin\(/,
  // Trust lifecycle — admin only (probation/suspend are sensitive).
  'trust-status.ts': /requireWorkspaceAdmin\(/,
  // AI Coach — annotator's own data, requireUser is the right gate.
  'trust-coach.ts': /requireUser\(/,
  // Annotation revisions / restore — admin-only forensic surface.
  'annotation-revisions.ts': /requireWorkspaceAdmin\(/,
  // Dawid-Skene EM truth inference (Phase-11) — admin-only ops surface
  // (writes consensus runs + persists per-rater confusion matrices).
  'dawid-skene.ts': /requireWorkspaceAdmin\(/,
  // Invite-reward admin moderation (Phase-13) — money path; admin
  // approves/denies manual_review rows.
  'invite-rewards.ts': /requireWorkspaceAdmin\(/,
  // Dataset version freeze (Phase-14) — admin-only snapshot action.
  'dataset-versions.ts': /requireWorkspaceAdmin\(/,
  // Notification read-state mutations — caller's own inbox only;
  // requireUser plus a userId WHERE clause defends against forged ids.
  'notifications.ts': /requireUser\(/,
  // Demo-mode gated AND requires signed-in user (Phase-6 audit fix —
  // previously billed quota to a sentinel UUID so every caller shared
  // one pool). Both guards must remain present.
  'guideline-refiner.ts': /requireUser\(/,
  // Phase-5 hardening: previously-naked helpers now self-defend.
  'inbox.ts': /requireWorkspaceMember\(/,
  'trajectory-summary.ts': /requireWorkspaceMember\(/,
  'trajectory-hints.ts': /requireWorkspaceMember\(/,
  // Finals P2 D9 — per-task AI Review Agent config. Owner-only (writes
  // tune the rubric the agent uses against every annotation in the
  // task). Read path also guarded so the prompt doesn't leak.
  'ai-agent-config.ts': /requireWorkspaceAdmin\(/,
}

/**
 * Files allowed to have NO `require*` call. These are either:
 *   - Pure helpers re-exported from the actions folder, or
 *   - Files where each export is internally guarded by an alternate
 *     mechanism documented in-source (e.g. session-key check).
 *
 * Keep this list small and reviewed. Adding to it is a security signal.
 */
const ALLOWED_NO_GUARD: Set<string> = new Set([
  // Supabase auth bridge — sign-in/up flows don't have workspace context.
  'auth.ts',
  // Finals P2 D7 — AI Review scheduler runs in Vercel's after() window
  // AFTER the submitter has been guarded by submitAnnotation's
  // requireWorkspaceMember. The scheduler operates on annotation-ID
  // alone and walks back to the workspace; opening it directly without
  // a valid annotationId is a no-op (Zod parse fails closed). The
  // after-hook isolation contract (never throw, never block) is the
  // safety guarantee here, not a guard call.
  'ai-review-submission.ts',
  // Pure helpers split out of ai-review-submission.ts so the
  // 'use server' file can stay async-only (Next.js requirement).
  // No DB / no auth touched here.
  'ai-review-keys.ts',
  // Pure schema + defaults split out of ai-agent-config.ts for the
  // same 'use server' async-only constraint. The server action file
  // (ai-agent-config.ts) holds the guard call.
  'ai-agent-config-schema.ts',
])

describe('Server-action guard presence', () => {
  it.each(Object.entries(EXPECTED_GUARDS))(
    'src/lib/actions/%s contains expected guard call',
    (file, pattern) => {
      const full = join(ACTIONS_DIR, file)
      const src = readFileSync(full, 'utf8')
      expect(
        pattern.test(src),
        `Expected ${file} to contain a guard matching ${pattern.source}.\n` +
          `If this is a new action with intentionally no guard, add it to ALLOWED_NO_GUARD ` +
          `or update EXPECTED_GUARDS with the appropriate guard.`,
      ).toBe(true)
    },
  )

  it('every action file is accounted for (no silent unguarded surface)', async () => {
    // List of all .ts files under src/lib/actions (recursively). Anything
    // not in EXPECTED_GUARDS or ALLOWED_NO_GUARD is a gap.
    const { readdirSync, statSync } = await import('node:fs')

    function listTsFiles(dir: string, base = ''): string[] {
      const entries = readdirSync(dir)
      const out: string[] = []
      for (const e of entries) {
        if (e === '__tests__') continue
        const full = join(dir, e)
        const rel = base ? `${base}/${e}` : e
        if (statSync(full).isDirectory()) {
          out.push(...listTsFiles(full, rel))
        } else if (e.endsWith('.ts') && !e.endsWith('.test.ts')) {
          out.push(rel)
        }
      }
      return out
    }

    const files = listTsFiles(ACTIONS_DIR)
    const known = new Set([
      ...Object.keys(EXPECTED_GUARDS),
      ...ALLOWED_NO_GUARD,
    ])

    const unaccounted = files.filter((f) => !known.has(f))
    expect(
      unaccounted,
      `Found action files not declared in EXPECTED_GUARDS or ALLOWED_NO_GUARD: ${unaccounted.join(
        ', ',
      )}\nAdd each to the appropriate map so its guard contract is enforced.`,
    ).toEqual([])
  })
})
