import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { users, workspaces } from '@/lib/db/schema'
import { getSupabaseServerClient } from '@/lib/supabase/server'
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
 * Cost: one parameterized INSERT ... ON CONFLICT DO NOTHING per authed request.
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

  // Mirror upsert
  const db = getDb()
  await db
    .insert(users)
    .values({
      id: user.id,
      email,
      displayName:
        (user.user_metadata?.display_name as string | undefined) ?? null,
    })
    .onConflictDoNothing()

  return { id: user.id, email }
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
 * Throws if user is not the admin of the given workspace.
 * Returns { user, workspace } for downstream use without a re-query.
 */
export async function requireWorkspaceAdmin(workspaceId: string) {
  const user = await requireUser()
  const db = getDb()
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)

  if (!workspace) throw new NotFoundError('Workspace')
  if (workspace.adminId !== user.id) throw new ForbiddenError()

  return { user, workspace }
}

/**
 * Membership check.
 *
 * MVP: same as admin since there's no annotator-membership table yet.
 * When we add per-workspace roles (later), this becomes a JOIN against a
 * `workspace_members` table that returns the role too.
 */
export async function requireWorkspaceMember(workspaceId: string) {
  return requireWorkspaceAdmin(workspaceId)
}
