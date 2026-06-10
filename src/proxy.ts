import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { oauthCallbackUrlFromEntrypoint } from '@/lib/auth/oauth-entrypoint'
import { updateSession } from '@/lib/supabase/proxy'

/**
 * Next.js 16 renamed `middleware.ts` → `proxy.ts`.
 * This file lives in `src/` because the app router is `src/app`.
 *
 * We delegate to a thin Supabase session-refresh helper so this stays minimal.
 */
export async function proxy(request: NextRequest) {
  const oauthCallbackUrl = oauthCallbackUrlFromEntrypoint(request.url)
  if (oauthCallbackUrl) {
    return NextResponse.redirect(oauthCallbackUrl, { status: 303 })
  }

  return await updateSession(request)
}

export const config = {
  // Skip static assets and Next internals.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
}
