import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

/**
 * Next.js 16 renamed `middleware.ts` → `proxy.ts`.
 * The exported function is `proxy`, runtime is `nodejs` (not edge).
 *
 * We delegate to a thin Supabase session-refresh helper so this stays minimal.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // Skip static assets and Next internals.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
}
