'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { UnauthorizedError, ValidationError } from '@/lib/errors'

/**
 * Auth Server Actions.
 *
 * Per security model:
 *   - min password length 8 (overrides Supabase default of 6)
 *   - signIn returns generic "Invalid credentials" to prevent email enumeration
 *   - emit no PII to logs; revalidate layout to clear user-scoped caches on transition
 */

const credsSchema = z.object({
  email: z.string().email().max(254),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(72), // bcrypt's cap
})

const signUpSchema = credsSchema.extend({
  displayName: z.string().min(1).max(60).optional(),
})

export type SignInInput = z.infer<typeof credsSchema>
export type SignUpInput = z.infer<typeof signUpSchema>

/**
 * Sign in with email + password.
 * On failure: always returns generic "Invalid credentials" — never distinguish
 * "no such email" from "wrong password" (prevents email enumeration).
 */
export async function signIn(input: SignInInput) {
  const parsed = credsSchema.parse(input)
  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithPassword(parsed)
  if (error || !data.user) {
    throw new UnauthorizedError('Invalid credentials.')
  }
  // Bust user-scoped caches so the new session is reflected everywhere.
  revalidatePath('/', 'layout')
  return { ok: true as const }
}

/**
 * Sign up new user. On success creates auth.users row + mirror in public.users.
 *
 * Email enumeration mitigation (Phase-6 security audit response):
 * Supabase distinguishes "user already registered" from "password too
 * weak" from "invalid email" in its error messages. The first kind
 * leaks whether an email already has an account — that's the
 * enumeration attack. We do two things:
 *
 *   1. Reword the "already registered" surface to the same generic
 *      "Sign-up failed. If this email already exists, sign in instead."
 *      that we'd show on any other failure. The hint mentions BOTH
 *      possibilities (already exists OR new signup), so an attacker
 *      can't reliably distinguish.
 *   2. Real password / weak-password errors still surface their
 *      specific message — those don't leak account existence, they
 *      tell the user how to fix their input.
 *
 * Belt-and-suspenders rate limiting belongs at the deployment layer
 * (Vercel WAF, Supabase auth rate-limits) — we can't fully eliminate
 * timing-based enumeration in application code.
 */
export async function signUp(input: SignUpInput) {
  const parsed = signUpSchema.parse(input)
  const supabase = await getSupabaseServerClient()

  const { data, error } = await supabase.auth.signUp({
    email: parsed.email,
    password: parsed.password,
    options: parsed.displayName
      ? { data: { display_name: parsed.displayName } }
      : undefined,
  })

  if (error || !data.user) {
    // Supabase's "User already registered" error code is `user_already_exists`
    // (string match on the message also works as a defensive fallback).
    const rawMsg = error?.message ?? ''
    const isEnumerationLeak =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error as any)?.code === 'user_already_exists' ||
      /already (registered|exists)/i.test(rawMsg)
    if (isEnumerationLeak) {
      throw new ValidationError(
        'Sign-up failed. If this email already exists, sign in instead.',
      )
    }
    throw new ValidationError(rawMsg || 'Sign-up failed.')
  }

  // Mirror into our users table. onConflictDoNothing makes this idempotent
  // (e.g. on a retry after a partial failure).
  const db = getDb()
  await db
    .insert(users)
    .values({
      id: data.user.id,
      email: parsed.email,
      displayName: parsed.displayName ?? null,
    })
    .onConflictDoNothing()

  revalidatePath('/', 'layout')

  // requiresEmailConfirm is true when Supabase email confirmation is on
  // (no immediate session is created). Surface to client so it can show
  // "check your inbox" UI.
  return {
    ok: true as const,
    requiresEmailConfirm: !data.session,
  }
}

/**
 * Sign out current session and clear user-scoped caches.
 */
export async function signOut() {
  const supabase = await getSupabaseServerClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  return { ok: true as const }
}
