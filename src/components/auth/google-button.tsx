'use client'

import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

/**
 * "Continue with Google" — kicks off the Supabase OAuth flow.
 *
 * Flow:
 *   1. User clicks button
 *   2. supabase.auth.signInWithOAuth() redirects to Google
 *   3. Google redirects back to our /auth/callback?code=...
 *   4. Callback exchanges the code, writes the cookie, redirects to `next`
 *
 * The button reads `next` from the current URL (set by /signin and /signup
 * pages when they're hit with `?next=...`). If no next param, defaults to `/`.
 *
 * Error UX: most failures happen on Google's side (consent cancelled, etc.),
 * so the surfaced error lands in /auth/callback via `?oauth_error=...` and
 * is shown by the signin page. Errors that happen BEFORE redirecting (env
 * misconfig, network) are caught here and shown inline.
 */

export function GoogleSignInButton({ label }: { label?: string }) {
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/'
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function go() {
    setError(null)
    startTransition(async () => {
      try {
        const supabase = getSupabaseBrowserClient()
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
            queryParams: {
              // Always show the account picker — annoying but means users with
              // multiple Google accounts don't accidentally sign in to the
              // wrong one.
              prompt: 'select_account',
            },
          },
        })
        if (error) setError(error.message)
        // Success path: browser is mid-redirect to Google — nothing more to do.
      } catch (e) {
        setError(e instanceof Error ? e.message : 'OAuth start failed.')
      }
    })
  }

  return (
    <div className="auth-oauth-wrap">
      <button
        type="button"
        onClick={go}
        disabled={isPending}
        className="auth-oauth-btn"
        aria-label="Sign in with Google"
      >
        <GoogleIcon />
        <span>{isPending ? 'redirecting…' : (label ?? 'Continue with Google')}</span>
      </button>
      {error && (
        <div className="auth-error mt-2" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

function GoogleIcon() {
  // Multicolor G — recognizable, no library dep.
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 18 18"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18Z"
        fill="#4285F4"
      />
      <path
        d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.04a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17Z"
        fill="#34A853"
      />
      <path
        d="M4.5 10.48a4.8 4.8 0 0 1 0-3.04V5.37H1.83a8 8 0 0 0 0 7.18l2.67-2.07Z"
        fill="#FBBC05"
      />
      <path
        d="M8.98 4.72c1.16 0 2.23.4 3.06 1.2l2.32-2.31A8 8 0 0 0 1.83 5.37L4.5 7.44a4.77 4.77 0 0 1 4.48-2.72Z"
        fill="#EA4335"
      />
    </svg>
  )
}
