import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Session-refresh helper called from root `proxy.ts` on every request.
 *
 * Per Next.js 16, middleware has been renamed to `proxy` and runs on the nodejs
 * runtime. Cookies on the *request* are mutable in this context, unlike Server
 * Components — so the Supabase session can actually be refreshed here.
 *
 * Guard: if env is missing (e.g. local dev without Supabase configured), this
 * is a no-op pass-through so the rest of the app still renders.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        )
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => {
          // Belt-and-suspenders for "stay signed in":
          //   Supabase SSR's defaults already set maxAge ~400 days, but
          //   we floor any session-only (undefined/0) cookie at 30 days
          //   so a browser quirk or a future SDK regression can't silently
          //   downgrade us to session cookies (lost on tab close).
          const safeOptions = {
            ...options,
            maxAge:
              options?.maxAge && options.maxAge > 0
                ? options.maxAge
                : 60 * 60 * 24 * 30,
          }
          response.cookies.set(name, value, safeOptions)
        })
      },
    },
  })

  // IMPORTANT: must call to refresh the auth token. Don't put anything between
  // createServerClient and getUser — otherwise sessions silently expire.
  await supabase.auth.getUser()

  return response
}
