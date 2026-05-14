import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Send an invitation email via Supabase Auth's built-in SMTP.
 *
 * Why this exists instead of using `getEmailSender()` (Resend):
 *
 *   Resend (and every other legit transactional ESP) requires a verified
 *   sending domain. We don't have one yet, and onboarding-domain restrictions
 *   prevent us from emailing arbitrary recipients.
 *
 *   Supabase's built-in auth SMTP DOES email arbitrary recipients (it's the
 *   same path that sends signup confirmations, password resets, magic links).
 *   The trick: we call `signInWithOtp` with `shouldCreateUser: true` and
 *   point `emailRedirectTo` at our existing `/invites/[token]` page. The
 *   one-time-link email is generated + sent by Supabase using their verified
 *   `mail.app.supabase.io` sender — high deliverability, zero domain setup.
 *
 * Limitations:
 *   - Supabase free tier rate-limits this endpoint (~4/hour per IP/email).
 *     Plenty for a demo, tight for a production launch.
 *   - The "from" name is "Supabase Auth" — not customizable on the free tier
 *     without setting up your own SMTP in Supabase Dashboard → Auth → SMTP.
 *   - The email body is the magic-link template (editable in Supabase
 *     Dashboard → Auth → Email Templates → Magic Link); we can customize
 *     the copy to read like an invite without changing this code.
 *
 * We use a SEPARATE Supabase client (not the SSR one with cookies) so we
 * don't accidentally hand the admin a partial session — `signInWithOtp`
 * tries to set local state when called from a session-aware client.
 */

let _oneShotClient: ReturnType<typeof createClient> | null = null
function getOneShotClient() {
  if (_oneShotClient) return _oneShotClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase env missing — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    )
  }
  _oneShotClient = createClient(url, key, {
    auth: {
      // No cookies, no localStorage. This client exists only to fire
      // server-side magic-link requests on behalf of admins.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return _oneShotClient
}

export interface MagicInviteResult {
  ok: boolean
  error?: string
  /** True when Supabase rate-limited us. UI should suggest copy-link fallback. */
  rateLimited?: boolean
}

/**
 * Trigger Supabase to send a one-time magic-link email to `email`.
 *
 * On click, the link signs the user in (creating their account if needed)
 * and redirects through our /auth/callback → finally to `emailRedirectTo`,
 * which should be a path that completes the invite acceptance
 * (typically `/invites/<token>`).
 */
export async function sendSupabaseMagicInvite(opts: {
  email: string
  /** Where the user lands AFTER /auth/callback finalizes their session. */
  postSignInPath: string
}): Promise<MagicInviteResult> {
  const client = getOneShotClient()
  const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'

  // The full redirect chain:
  //   1. User clicks email link → Supabase verify endpoint
  //   2. Supabase exchanges → redirects with ?code=... to emailRedirectTo
  //   3. Our /auth/callback exchanges code → sets cookie → redirects to next
  //   4. /invites/[token] picks up the now-authed user, accepts invite
  const callbackUrl = `${base}/auth/callback?next=${encodeURIComponent(opts.postSignInPath)}`

  const { error } = await client.auth.signInWithOtp({
    email: opts.email,
    options: {
      emailRedirectTo: callbackUrl,
      // Critical: we want this to also CREATE a user account if they don't
      // have one. Without this flag, Supabase silently returns ok but never
      // sends to unknown emails — terrible UX.
      shouldCreateUser: true,
    },
  })

  if (!error) return { ok: true }

  // Rate-limit messages from Supabase contain "rate limit exceeded" or
  // "too many requests". Distinguish so the UI can surface the right
  // "copy link" fallback instead of looking like a hard failure.
  const msg = error.message ?? 'unknown'
  const rateLimited = /rate limit|too many/i.test(msg)
  return { ok: false, error: msg, rateLimited }
}
