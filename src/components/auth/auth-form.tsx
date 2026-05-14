'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn, signUp } from '@/lib/actions/auth'
import { GoogleSignInButton } from './google-button'

/**
 * Shared sign-in / sign-up form.
 *
 * The mode prop chooses which Server Action gets called and tweaks copy.
 * Both flows redirect to the `next` query param on success (fallback `/`).
 *
 * Error handling:
 *   - signIn returns generic "Invalid credentials" — we surface it verbatim.
 *   - signUp surfaces Supabase's message, which can include "User already
 *     registered" / "Password too weak" — those are useful to the user.
 *   - Both throw on network failure; we catch and show a one-line error.
 *
 * The form is intentionally minimal — judges shouldn't have to fight a
 * registration funnel. No "terms of service" checkbox, no marketing
 * opt-ins, no captcha. Just enough to test-drive the platform.
 */

export type AuthMode = 'signin' | 'signup'

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/'
  const [isPending, startTransition] = useTransition()
  // OAuth callback may bounce back here with ?oauth_error=... (Google
  // consent cancelled, etc.). Surface as a top-of-form notice so the
  // user sees why they're not signed in.
  const oauthError = searchParams.get('oauth_error')
  const [error, setError] = useState<string | null>(oauthError)
  const [info, setInfo] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    const fd = new FormData(e.currentTarget)
    const email = String(fd.get('email') ?? '')
    const password = String(fd.get('password') ?? '')
    const displayName = String(fd.get('displayName') ?? '').trim() || undefined

    startTransition(async () => {
      try {
        if (mode === 'signin') {
          await signIn({ email, password })
          router.push(next)
          router.refresh()
        } else {
          const result = await signUp({ email, password, displayName })
          if (result.requiresEmailConfirm) {
            setInfo(
              "Check your inbox to confirm your email, then sign in.",
            )
            return
          }
          router.push(next)
          router.refresh()
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Something went wrong.'
        setError(msg)
      }
    })
  }

  const headline =
    mode === 'signin' ? 'Sign in to LabelHub' : 'Create your LabelHub account'
  const subhead =
    mode === 'signin'
      ? 'Resume your workspaces, marks, and trajectories.'
      : 'One credential, every template mode. No card needed for the trial.'
  const cta = mode === 'signin' ? 'Sign in' : 'Create account'
  const altHref = mode === 'signin' ? '/signup' : '/signin'
  const altLabel =
    mode === 'signin'
      ? "New here? Create an account →"
      : 'Already have one? Sign in →'

  return (
    <div className="auth-shell">
      <header className="auth-header">
        <a href="/" aria-label="LabelHub home" className="auth-logo">
          <svg width="22" height="22" viewBox="0 0 18 18" fill="none">
            <rect
              x="0.5"
              y="0.5"
              width="17"
              height="17"
              rx="4"
              stroke="oklch(0.6 0.18 280)"
            />
            <path
              d="M5 4.5V13.5H13"
              stroke="oklch(0.6 0.18 280)"
              strokeWidth="1.5"
              strokeLinecap="square"
            />
          </svg>
          <span>LabelHub</span>
        </a>
      </header>

      <main className="auth-main">
        <div className="auth-card">
          <h1 className="auth-h1">{headline}</h1>
          <p className="auth-sub">{subhead}</p>

          {/* OAuth primary path — most users prefer this over typing a
              password. Sits ABOVE the form so it's the default eye-line.
              Disabled gracefully when GOOGLE OAuth provider isn't
              configured in the Supabase dashboard — Supabase will return
              an error which lands in the callback's ?oauth_error path. */}
          <GoogleSignInButton
            label={mode === 'signin' ? 'Continue with Google' : 'Sign up with Google'}
          />

          <div className="auth-divider" role="separator" aria-orientation="horizontal">
            <span>or</span>
          </div>

          <form onSubmit={onSubmit} className="auth-form" noValidate>
            {mode === 'signup' && (
              <label className="auth-field">
                <span className="auth-label">Display name (optional)</span>
                <input
                  type="text"
                  name="displayName"
                  autoComplete="name"
                  maxLength={60}
                  className="auth-input"
                  placeholder="e.g. Sasha Chen"
                />
              </label>
            )}
            <label className="auth-field">
              <span className="auth-label">Email</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                maxLength={254}
                className="auth-input"
                placeholder="you@example.com"
              />
            </label>
            <label className="auth-field">
              <span className="auth-label">Password</span>
              <input
                type="password"
                name="password"
                autoComplete={
                  mode === 'signin' ? 'current-password' : 'new-password'
                }
                required
                minLength={8}
                maxLength={72}
                className="auth-input"
                placeholder={mode === 'signup' ? 'min 8 characters' : ''}
              />
            </label>

            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}
            {info && (
              <div className="auth-info" role="status">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
              className="lh-btn lh-btn-solid auth-submit"
            >
              {isPending ? 'Working…' : cta}
            </button>
          </form>

          <div className="auth-alt">
            <a href={altHref}>{altLabel}</a>
          </div>
        </div>

        <p className="auth-skip">
          Just want to look around?{' '}
          <a href="/workspaces/00000000-0000-0000-0000-000000000010">
            Tour the public demo →
          </a>
        </p>
      </main>
    </div>
  )
}
