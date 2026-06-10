import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { mirrorAuthUser } from '@/lib/auth/mirror-user'
import { normalizeSupabaseCookieOptions } from '@/lib/supabase/cookie-options'
import { publicUrl } from '@/lib/http/public-origin'

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
    const redirectUrl = publicUrl('/signin', request)
    redirectUrl.searchParams.set(
      'oauth_error',
      errorDescription ?? errorParam,
    )
    if (nextRaw) redirectUrl.searchParams.set('next', next)
    return NextResponse.redirect(redirectUrl, { status: 303 })
  }

  if (!code) {
    return NextResponse.redirect(publicUrl('/signin', request), {
      status: 303,
    })
  }

  const env = getSupabaseEnv()
  if (!env) {
    const redirectUrl = publicUrl('/signin', request)
    redirectUrl.searchParams.set('oauth_error', 'Supabase auth is not configured.')
    return NextResponse.redirect(redirectUrl, { status: 303 })
  }

  const successUrl = publicUrl(next, request)
  const response = NextResponse.redirect(successUrl, { status: 303 })
  const cookieWrites: Array<{
    name: string
    value: string
    options: CookieOptions
  }> = []
  const headerWrites: Record<string, string> = {}

  const applyAuthSideEffects = (target: NextResponse) => {
    Object.entries(headerWrites).forEach(([key, value]) =>
      target.headers.set(key, value),
    )
    cookieWrites.forEach(({ name, value, options }) => {
      target.cookies.set(
        name,
        value,
        normalizeSupabaseCookieOptions(options, env.insecureCookies),
      )
    })
    return target
  }

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value)
        })
        Object.assign(headerWrites, headers)
        cookieWrites.push(...cookiesToSet)
        applyAuthSideEffects(response)
      },
    },
  })
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    const redirectUrl = publicUrl('/signin', request)
    redirectUrl.searchParams.set('oauth_error', error.message)
    return applyAuthSideEffects(
      NextResponse.redirect(redirectUrl, { status: 303 }),
    )
  }

  // Mirror into public.users so requireUser() doesn't have to lazy-insert.
  // Best-effort — if the DB call fails we still send the user on; the next
  // requireUser() call will retry the upsert.
  if (data.user) {
    try {
      const email = data.user.email
      if (email) {
        await mirrorAuthUser({
          id: data.user.id,
          email,
          metadata: data.user.user_metadata,
        })
      }
    } catch {
      // Swallow — the requireUser() upsert path covers this if it ever
      // matters; we just save it a round-trip when it works.
    }
  }

  return response
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

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return {
    url,
    key,
    insecureCookies: process.env.INSECURE_COOKIES === 'true',
  }
}
