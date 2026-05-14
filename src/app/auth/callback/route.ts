import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getDb } from '@/lib/db/client'
import { users } from '@/lib/db/schema'

/**
 * GET /auth/callback?code=...&next=/somewhere
 *
 * Where the OAuth flow lands AFTER Google redirects back. Supabase's edge
 * receives the `code` query param, we exchange it for a session (writing
 * the cookie chain via the SSR client's setAll hook), then redirect the
 * user where they were going.
 *
 * Also mirrors the new auth user into our `public.users` table so guards
 * + queries that depend on the mirror don't need a "first-authed-request"
 * lazy-insert race.
 *
 * Used by Google for now; same shape works for any other Supabase-supported
 * OAuth provider (GitHub, Apple, etc.) — just point the `redirectTo` from
 * the trigger button at this same callback.
 */

const ALLOWED_PROVIDERS = ['google', 'github'] as const

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const errorParam = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  // Sanitize the `next` redirect — only same-origin paths.
  const nextRaw = url.searchParams.get('next')
  const next = safeNext(nextRaw)

  if (errorParam) {
    // User cancelled at the Google consent screen, or provider returned an
    // error. Send them to /signin with a surfaced error so they see why.
    const redirectUrl = new URL('/signin', url.origin)
    redirectUrl.searchParams.set(
      'oauth_error',
      errorDescription ?? errorParam,
    )
    if (nextRaw) redirectUrl.searchParams.set('next', next)
    return NextResponse.redirect(redirectUrl, { status: 303 })
  }

  if (!code) {
    return NextResponse.redirect(new URL('/signin', url.origin), {
      status: 303,
    })
  }

  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    const redirectUrl = new URL('/signin', url.origin)
    redirectUrl.searchParams.set('oauth_error', error.message)
    return NextResponse.redirect(redirectUrl, { status: 303 })
  }

  // Mirror into public.users so requireUser() doesn't have to lazy-insert.
  // Best-effort — if the DB call fails we still send the user on; the next
  // requireUser() call will retry the upsert.
  if (data.user) {
    try {
      const email = data.user.email
      const displayName =
        (data.user.user_metadata?.full_name as string | undefined) ??
        (data.user.user_metadata?.name as string | undefined) ??
        null
      if (email) {
        await getDb()
          .insert(users)
          .values({ id: data.user.id, email, displayName })
          .onConflictDoNothing()
      }
    } catch {
      // Swallow — the requireUser() upsert path covers this if it ever
      // matters; we just save it a round-trip when it works.
    }
  }

  return NextResponse.redirect(new URL(next, url.origin), { status: 303 })
}

function safeNext(next: string | null): string {
  if (!next) return '/'
  if (!next.startsWith('/')) return '/'
  if (next.startsWith('//')) return '/' // protocol-relative; reject
  return next
}

// Expose the provider whitelist for the trigger button to import — keeps the
// set of allowed providers single-sourced in this file.
export const _ALLOWED_PROVIDERS = ALLOWED_PROVIDERS
