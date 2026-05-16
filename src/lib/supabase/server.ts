import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

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

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            // Floor session-only cookies at 30 days so closing the tab
            // doesn't sign the user out. Supabase SSR's defaults already
            // do this; explicit ceiling here in case a future SDK
            // regression sends maxAge=undefined.
            const safeOptions = {
              ...options,
              maxAge:
                options?.maxAge && options.maxAge > 0
                  ? options.maxAge
                  : 60 * 60 * 24 * 30,
            }
            cookieStore.set(name, value, safeOptions)
          })
        } catch {
          // Called from a Server Component where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  })
}
