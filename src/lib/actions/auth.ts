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
 * Supabase's own errors are surfaced here (e.g. "User already registered",
 * "Password too weak"). These DO leak existence of an email, but that's
 * inherent to email-based sign-up — mitigation lives at the rate-limit layer.
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
    throw new ValidationError(error?.message ?? 'Sign-up failed.')
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
