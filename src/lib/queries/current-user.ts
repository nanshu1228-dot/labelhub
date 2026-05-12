import 'server-only'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Read-only current user fetch for Server Components.
 * Returns null if not signed in (does NOT throw).
 *
 * Difference from `requireUser()` in `lib/auth/guards.ts`:
 *   - This is for RENDERING paths where the page renders for anon users too.
 *   - `requireUser()` is for MUTATIONS / protected resources; it throws.
 *
 * No DB-mirror upsert here — pure read.
 */
export async function getCurrentUser() {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return null
  return {
    id: user.id,
    email: user.email ?? null,
    displayName:
      (user.user_metadata?.display_name as string | undefined) ?? null,
  }
}
