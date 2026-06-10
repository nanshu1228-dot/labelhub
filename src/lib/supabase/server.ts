import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { normalizeSupabaseCookieOptions } from './cookie-options'

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Per Next.js 16: cookies() is async — MUST await.
 *
 * Throws if env vars are missing so callers fail fast rather than silently
 * hitting "no rows" everywhere.
 */
export async function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. See .env.example.',
    )
  }

  const cookieStore = await cookies()
  // Opt-in HTTP fallback for finals self-host demo: when the deploy URL is
  // plain HTTP (overseas IP, no TLS terminator in front), modern browsers
  // refuse Set-Cookie with Secure=true. Setting INSECURE_COOKIES=true in
  // env forces secure=false so the demo's password login actually works.
  // Production HTTPS deploys leave this unset → @supabase/ssr default
  // (secure=true in production) applies.
  const insecureCookies = process.env.INSECURE_COOKIES === 'true'

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(
              name,
              value,
              normalizeSupabaseCookieOptions(options, insecureCookies),
            )
          })
        } catch {
          // Called from a Server Component where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  })
}
