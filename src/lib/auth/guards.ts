import 'server-only'
import { cache } from 'react'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { workspaceMembers, workspaces } from '@/lib/db/schema'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { mirrorAuthUser } from './mirror-user'
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '@/lib/errors'

/**
 * Auth + authorization guards.
 *
 * Per security model: server-side guards are the only source of truth.
 * Every Server Action calls one of these as its second line (after Zod.parse).
 */

export type AuthUser = {
  id: string
  email: string
}

/**
 * Hard auth: throws UnauthorizedError if no session.
 *
 * Also performs a defense-in-depth mirror upsert: ensures our `users` row
 * exists for this Supabase auth user. Handles edge cases like:
 *   - sign-up's DB mirror insert failed mid-transaction
 *   - user came in via magic link / OAuth (bypassed our signUp)
 *
 * Cost: one parameterized mirror upsert per authed request.
 * Acceptable for MVP; optimize via React.cache() or skip on hot paths later.
 */
export async function requireUser(): Promise<AuthUser> {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw new UnauthorizedError()

  const email = user.email ?? ''
  if (!email) {
    // Defensive: every flow we support requires email. If missing, treat as anonymous.
    throw new UnauthorizedError('User has no email — re-authenticate.')
  }

  const mirrored = await mirrorAuthUser({
    id: user.id,
    email,
    metadata: user.user_metadata,
  })

  return { id: mirrored.id, email: mirrored.email }
}

/**
 * Soft auth: returns null if no session.
 * Use in rendering paths where unauth users see a different (still-valid) view.
 * NEVER use this in front of a mutation — use `requireUser()` instead.
 */
export async function optionalUser(): Promise<AuthUser | null> {
  try {
    return await requireUser()
  } catch {
    return null
  }
}

/**
 * Throws if user is not an admin of the given workspace.
 *
 * Source of truth: `workspace_members.role = 'admin'`. The legacy
 * `workspaces.admin_id` is kept ONLY for backward compat with the
 * workspace-creator concept — every creator gets an `admin` row in
 * workspace_members on creation, so the JOIN below is sufficient.
 *
 * Returns { user, workspace, role } so downstream code can branch without
 * a re-query.
 */
export async function requireWorkspaceAdmin(workspaceId: string) {
  const user = await requireUser()
  const db = getDb()
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaces)
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(eq(workspaces.id, workspaceId))
    .limit(1)

  if (rows.length === 0 || !rows[0].workspace) {
    throw new NotFoundError('Workspace')
  }
  const { workspace, role } = rows[0]
  // Legacy fallback: workspaces.admin_id is admin even if members row
  // hasn't been backfilled. New workspaces always have the row.
  const isAdmin = role === 'admin' || workspace.adminId === user.id
  if (!isAdmin) throw new ForbiddenError('Workspace admin required.')

  return { user, workspace, role: 'admin' as const }
}

/**
 * Workspace role values. Stratified — each one is a superset of the next:
 *   admin → can do everything qc can + workspace management
 *   qc    → can do everything annotator can + quality-check review
 *   annotator → can submit annotations
 *   viewer → read-only
 */
export type WorkspaceRole = 'admin' | 'qc' | 'annotator' | 'viewer'

/**
 * Membership check — any role passes (including viewer).
 *
 * Returns the user's role so callers can branch on it without re-querying.
 */
export async function requireWorkspaceMember(workspaceId: string) {
  const user = await requireUser()
  const db = getDb()
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaces)
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(eq(workspaces.id, workspaceId))
    .limit(1)

  if (rows.length === 0 || !rows[0].workspace) {
    throw new NotFoundError('Workspace')
  }
  const { workspace, role } = rows[0]
  // Legacy fallback.
  const effectiveRole =
    role ?? (workspace.adminId === user.id ? 'admin' : null)
  if (!effectiveRole) {
    throw new ForbiddenError('Not a member of this workspace.')
  }
  return {
    user,
    workspace,
    role: effectiveRole as WorkspaceRole,
  }
}

/**
 * QC-or-above check — admin OR qc roles pass. Used by quality-check
 * server actions: only QC reviewers and admins can run the
 * pass/打回 verdict on a submitted annotation.
 *
 * Returns { user, workspace, role } so callers can still distinguish
 * admin from qc when they need finer-grained logic (e.g. only admin
 * can terminally reject; QC can only request_revision).
 */
export async function requireWorkspaceQC(workspaceId: string) {
  const result = await requireWorkspaceMember(workspaceId)
  if (result.role !== 'admin' && result.role !== 'qc') {
    throw new ForbiddenError(
      'Quality-check review requires the qc or admin role.',
    )
  }
  return result
}

/**
 * Cross-workspace role summary — Finals D20-A.
 *
 * Drives the AppHeader's role-aware entry pills. One query against
 * `workspace_members` per request; result tells the header whether
 * the signed-in user has admin / qc / annotator role in ANY
 * workspace, so:
 *   - "Admin" pill renders iff hasAdmin
 *   - "Review" pill renders iff hasQc || hasAdmin
 *   - "Queue" pill renders iff hasAnnotator || hasQc || hasAdmin
 *
 * Wrapped in React.cache so multiple components in one render share
 * a single DB roundtrip. Returns the zero-state when the userId is
 * missing (unauthenticated header still renders, just with the
 * wordmark + sign-in link).
 */
export interface RoleSummary {
  hasAdmin: boolean
  hasQc: boolean
  hasAnnotator: boolean
}

export const resolveRoleSummary = cache(
  async (userId: string | null | undefined): Promise<RoleSummary> => {
    if (!userId) {
      return { hasAdmin: false, hasQc: false, hasAnnotator: false }
    }
    const db = getDb()
    const rows = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
    let hasAdmin = false
    let hasQc = false
    let hasAnnotator = false
    for (const r of rows) {
      if (r.role === 'admin') hasAdmin = true
      else if (r.role === 'qc') hasQc = true
      else if (r.role === 'annotator') hasAnnotator = true
    }
    return { hasAdmin, hasQc, hasAnnotator }
  },
)
