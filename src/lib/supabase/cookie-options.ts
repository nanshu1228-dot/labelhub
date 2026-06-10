import type { CookieOptions } from '@supabase/ssr'

const FALLBACK_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export function normalizeSupabaseCookieOptions(
  options: CookieOptions,
  insecureCookies: boolean,
): CookieOptions {
  const safeOptions: CookieOptions = { ...options }

  // Preserve explicit deletion cookies. Supabase uses maxAge=0 or a past
  // expires value to clear OAuth PKCE/session cookies; only floor truly
  // session-only cookies where neither field is present.
  if (safeOptions.maxAge === undefined && safeOptions.expires === undefined) {
    safeOptions.maxAge = FALLBACK_COOKIE_MAX_AGE
  }
  if (insecureCookies) {
    safeOptions.secure = false
  }
  return safeOptions
}
