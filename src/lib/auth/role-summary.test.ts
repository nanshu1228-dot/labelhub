import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}))

// Strip Next.js's @ alias resolution issues with the supabase mock —
// the helper itself doesn't touch supabase but the module pulls
// `getSupabaseServerClient` in via guards.ts.
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
}))

import { resolveRoleSummary } from './guards'
import { getDb } from '@/lib/db/client'

/**
 * Role-summary cross-workspace tests — Finals D20-A.
 *
 * resolveRoleSummary drives the AppHeader's role-aware entry pills.
 * Correctness gate: an admin in ANY workspace gets hasAdmin=true,
 * etc. The header reads these flags once per render (React.cache).
 */

function mountDb(rows: Array<{ role: string }>) {
  vi.mocked(getDb).mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset the React.cache between tests so the wrapper doesn't
  // return a stale per-test result. resolveRoleSummary is wrapped
  // via React's `cache()`, which caches within a single render scope;
  // in Vitest's per-test scope, the cache resets naturally so we
  // don't need to clear anything special.
})

describe('resolveRoleSummary — happy paths', () => {
  it('returns all-false for null userId', async () => {
    const r = await resolveRoleSummary(null)
    expect(r).toEqual({
      hasAdmin: false,
      hasQc: false,
      hasAnnotator: false,
    })
  })

  it('returns all-false for undefined userId', async () => {
    const r = await resolveRoleSummary(undefined)
    expect(r).toEqual({
      hasAdmin: false,
      hasQc: false,
      hasAnnotator: false,
    })
  })

  it('returns all-false when DB returns no rows', async () => {
    mountDb([])
    const r = await resolveRoleSummary('user-empty')
    expect(r).toEqual({
      hasAdmin: false,
      hasQc: false,
      hasAnnotator: false,
    })
  })

  it('hasAdmin=true when at least one row is admin', async () => {
    mountDb([{ role: 'admin' }, { role: 'annotator' }])
    const r = await resolveRoleSummary('user-admin')
    expect(r.hasAdmin).toBe(true)
    expect(r.hasAnnotator).toBe(true)
    expect(r.hasQc).toBe(false)
  })

  it('hasQc=true when at least one row is qc', async () => {
    mountDb([{ role: 'qc' }])
    const r = await resolveRoleSummary('user-qc')
    expect(r).toEqual({
      hasAdmin: false,
      hasQc: true,
      hasAnnotator: false,
    })
  })

  it('hasAnnotator=true when only annotator role(s)', async () => {
    mountDb([{ role: 'annotator' }, { role: 'annotator' }])
    const r = await resolveRoleSummary('user-annotator')
    expect(r).toEqual({
      hasAdmin: false,
      hasQc: false,
      hasAnnotator: true,
    })
  })

  it('mixed roles across workspaces all surface true', async () => {
    mountDb([
      { role: 'admin' },
      { role: 'qc' },
      { role: 'annotator' },
    ])
    const r = await resolveRoleSummary('user-multi')
    expect(r).toEqual({
      hasAdmin: true,
      hasQc: true,
      hasAnnotator: true,
    })
  })

  it("ignores unknown roles (e.g. 'viewer')", async () => {
    mountDb([{ role: 'viewer' }, { role: 'random-future-role' }])
    const r = await resolveRoleSummary('user-only-viewer')
    expect(r).toEqual({
      hasAdmin: false,
      hasQc: false,
      hasAnnotator: false,
    })
  })
})
