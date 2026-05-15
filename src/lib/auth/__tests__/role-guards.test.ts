import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies BEFORE importing the module under test. Vitest hoists
// vi.mock to the top of the file, but the module imports happen at import
// time, so we use vi.hoisted-friendly factory style.
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
}))

import {
  requireUser,
  requireWorkspaceMember,
  requireWorkspaceQC,
  requireWorkspaceAdmin,
} from '../guards'
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/errors'
import { getDb } from '@/lib/db/client'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Test the four role-guard helpers against the matrix in
 * docs/ROLE_PERMISSIONS.md. Every guard is responsible for one slice of
 * the authorization stack and must throw the exact typed error the
 * server actions rely on:
 *
 *   - requireUser:           UnauthorizedError when no session
 *   - requireWorkspaceMember: NotFoundError (missing) / ForbiddenError (not a member)
 *   - requireWorkspaceQC:    admin + qc pass; annotator / viewer get ForbiddenError
 *   - requireWorkspaceAdmin: admin only; legacy workspaces.adminId fallback
 *
 * We mock both the DB client and the Supabase client so the guards run
 * as pure logic — no real network calls.
 */

/** Build a minimal mock of getSupabaseServerClient's return value. */
function setupAuth(
  user: { id: string; email: string; metadata?: Record<string, unknown> } | null,
  errorMessage?: string,
) {
  vi.mocked(getSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: {
          user: user
            ? {
                id: user.id,
                email: user.email,
                user_metadata: user.metadata ?? {},
              }
            : null,
        },
        error: errorMessage ? new Error(errorMessage) : null,
      }),
    },
  } as never)
}

/**
 * Build a mock drizzle db client that returns the given rows from the
 * standard guards.ts query chain:
 *
 *   db.select(...).from(workspaces).leftJoin(...).where(...).limit(1)
 *
 * Plus passes through the requireUser mirror upsert
 * (db.insert.values.onConflictDoNothing).
 */
function setupDb(workspaceRows: unknown[]) {
  vi.mocked(getDb).mockReturnValue({
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => Promise.resolve(),
      }),
    }),
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve(workspaceRows),
          }),
        }),
      }),
    }),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

const USER = { id: 'user-1', email: 'tester@labelhub.dev' }
const WS = { id: 'ws-1', name: 'Test WS', adminId: 'admin-of-ws-1' }

describe('requireUser', () => {
  it('throws UnauthorizedError when no session', async () => {
    setupAuth(null)
    setupDb([])
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('throws UnauthorizedError when supabase returns an error', async () => {
    setupAuth(null, 'token expired')
    setupDb([])
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('throws UnauthorizedError when user has no email', async () => {
    // Email-less users (rare OAuth edge case) treated as anonymous.
    setupAuth({ id: 'no-email', email: '' })
    setupDb([])
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('returns {id, email} for valid session', async () => {
    setupAuth(USER)
    setupDb([])
    await expect(requireUser()).resolves.toEqual({
      id: USER.id,
      email: USER.email,
    })
  })

  it('performs mirror upsert on success (does not throw)', async () => {
    // Defense-in-depth: the user row must exist locally; the upsert is
    // idempotent. Just exercise the code path — the mock returns void.
    setupAuth({ ...USER, metadata: { display_name: 'Display Name' } })
    setupDb([])
    await expect(requireUser()).resolves.toEqual({
      id: USER.id,
      email: USER.email,
    })
  })
})

describe('requireWorkspaceMember', () => {
  it('throws UnauthorizedError when not signed in', async () => {
    setupAuth(null)
    setupDb([])
    await expect(requireWorkspaceMember(WS.id)).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
  })

  it('throws NotFoundError when workspace does not exist', async () => {
    setupAuth(USER)
    setupDb([])
    await expect(requireWorkspaceMember(WS.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('throws NotFoundError when row has null workspace (left-join miss)', async () => {
    setupAuth(USER)
    setupDb([{ workspace: null, role: null }])
    await expect(requireWorkspaceMember(WS.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('throws ForbiddenError when user is not a member', async () => {
    setupAuth(USER)
    // Workspace exists, but member row missing AND user is not the creator.
    setupDb([{ workspace: WS, role: null }])
    await expect(requireWorkspaceMember(WS.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it.each([
    ['admin' as const],
    ['qc' as const],
    ['annotator' as const],
    ['viewer' as const],
  ])('returns role=%s for a member with role=%s', async (role) => {
    setupAuth(USER)
    setupDb([{ workspace: WS, role }])
    const result = await requireWorkspaceMember(WS.id)
    expect(result.role).toBe(role)
    expect(result.workspace.id).toBe(WS.id)
    expect(result.user.id).toBe(USER.id)
  })

  it('legacy fallback: workspace creator (no role row) is treated as admin', async () => {
    // Old workspaces created before the members table existed: only
    // workspaces.admin_id identifies the creator. Guard returns 'admin'.
    const ws = { ...WS, adminId: USER.id }
    setupAuth(USER)
    setupDb([{ workspace: ws, role: null }])
    const result = await requireWorkspaceMember(ws.id)
    expect(result.role).toBe('admin')
  })
})

describe('requireWorkspaceQC', () => {
  // QC gate: admin AND qc pass; annotator + viewer get ForbiddenError.
  // Sourced from docs/ROLE_PERMISSIONS.md "Quality check (qc)" section.
  it.each([
    ['admin' as const, true],
    ['qc' as const, true],
    ['annotator' as const, false],
    ['viewer' as const, false],
  ])('role=%s → allowed=%s', async (role, allowed) => {
    setupAuth(USER)
    setupDb([{ workspace: WS, role }])
    if (allowed) {
      const result = await requireWorkspaceQC(WS.id)
      expect(result.role).toBe(role)
    } else {
      await expect(requireWorkspaceQC(WS.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    }
  })

  it('throws ForbiddenError when user is not a member', async () => {
    setupAuth(USER)
    setupDb([{ workspace: WS, role: null }])
    await expect(requireWorkspaceQC(WS.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('throws NotFoundError when workspace does not exist', async () => {
    setupAuth(USER)
    setupDb([])
    await expect(requireWorkspaceQC(WS.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('throws UnauthorizedError when not signed in', async () => {
    setupAuth(null)
    setupDb([])
    await expect(requireWorkspaceQC(WS.id)).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
  })

  it('legacy fallback: workspace creator is admin → passes QC gate', async () => {
    const ws = { ...WS, adminId: USER.id }
    setupAuth(USER)
    setupDb([{ workspace: ws, role: null }])
    const result = await requireWorkspaceQC(ws.id)
    expect(result.role).toBe('admin')
  })
})

describe('requireWorkspaceAdmin', () => {
  // Admin gate: ONLY admin passes. qc, annotator, viewer all blocked.
  // Sourced from docs/ROLE_PERMISSIONS.md "Acceptance (admin only)" section.
  it.each([
    ['admin' as const, true],
    ['qc' as const, false],
    ['annotator' as const, false],
    ['viewer' as const, false],
  ])('role=%s → allowed=%s', async (role, allowed) => {
    setupAuth(USER)
    setupDb([{ workspace: WS, role }])
    if (allowed) {
      const result = await requireWorkspaceAdmin(WS.id)
      expect(result.role).toBe('admin')
    } else {
      await expect(requireWorkspaceAdmin(WS.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    }
  })

  it('legacy fallback: workspace creator passes even without member row', async () => {
    const ws = { ...WS, adminId: USER.id }
    setupAuth(USER)
    setupDb([{ workspace: ws, role: null }])
    const result = await requireWorkspaceAdmin(ws.id)
    expect(result.role).toBe('admin')
  })

  it('throws NotFoundError when workspace does not exist', async () => {
    setupAuth(USER)
    setupDb([])
    await expect(requireWorkspaceAdmin(WS.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('throws UnauthorizedError when not signed in', async () => {
    setupAuth(null)
    setupDb([])
    await expect(requireWorkspaceAdmin(WS.id)).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
  })

  it('throws ForbiddenError when user is not a member and not the creator', async () => {
    setupAuth(USER)
    // Workspace exists, but user is neither in workspace_members nor the
    // legacy adminId. Should be Forbidden.
    setupDb([{ workspace: WS, role: null }])
    await expect(requireWorkspaceAdmin(WS.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})
