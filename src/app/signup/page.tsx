import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { AuthForm } from '@/components/auth/auth-form'

export const metadata: Metadata = {
  title: 'Sign up — LabelHub',
}

/**
 * /signup — twin of /signin. Same redirect-when-authed semantics.
 */
export default async function SignUpPage(
  props: { searchParams?: Promise<{ next?: string }> },
) {
  const params = (await props.searchParams) ?? {}
  const user = await optionalUser()
  if (user) {
    redirect(safeNext(params.next))
  }
  return <AuthForm mode="signup" />
}

function safeNext(next: string | undefined): string {
  if (!next) return '/'
  if (!next.startsWith('/')) return '/'
  if (next.startsWith('//')) return '/'
  return next
}
