import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { AuthForm } from '@/components/auth/auth-form'

export const metadata: Metadata = {
  title: 'Sign in — LabelHub',
}

/**
 * /signin — server-rendered.
 *
 * Redirects already-authenticated users away (back to `next` if provided,
 * else `/`) so the back button doesn't trap them on the login page.
 *
 * The form itself is a client component because it needs `useTransition`
 * and `useSearchParams`.
 */
export default async function SignInPage(
  props: { searchParams?: Promise<{ next?: string }> },
) {
  const params = (await props.searchParams) ?? {}
  const user = await optionalUser()
  if (user) {
    redirect(safeNext(params.next))
  }
  return <AuthForm mode="signin" />
}

/**
 * Sanitize the `next` redirect to prevent open-redirect attacks.
 * Only same-origin paths starting with `/` (and not `//`) are accepted.
 */
function safeNext(next: string | undefined): string {
  if (!next) return '/'
  if (!next.startsWith('/')) return '/'
  if (next.startsWith('//')) return '/'
  return next
}
