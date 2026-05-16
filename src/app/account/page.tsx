import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { optionalUser } from '@/lib/auth/guards'
import { listMyWorkspaces } from '@/lib/actions/membership'
import { userAdminsAnyWorkspace } from '@/lib/queries/admin-dashboard'
import { AccountClient } from '@/components/account/account-client'

export const metadata: Metadata = {
  title: 'Account — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /account
 *
 * Personal profile + workspace list. Server-renders:
 *   - the signed-in user (otherwise redirect to /signin)
 *   - their display name + email
 *   - workspace memberships with role pills
 *
 * Client handles the display-name edit form + the sign-out button.
 */
export default async function AccountPage() {
  const me = await optionalUser()
  if (!me) redirect('/signin?next=/account')

  const db = getDb()
  const [profile] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, me.id))
    .limit(1)

  const [myWorkspaces, isAdminAnywhere] = await Promise.all([
    listMyWorkspaces().catch(() => []),
    userAdminsAnyWorkspace(me.id).catch(() => false),
  ])

  return (
    <div className="app-light min-h-screen" style={{ background: 'var(--bg)' }}>
      <header
        className="hairline-b sticky top-0 z-10"
        style={{ background: 'var(--panel)' }}
      >
        <div className="mx-auto max-w-[900px] flex items-center justify-between px-6 py-3">
          <nav
            className="ts-12 mono flex items-center gap-1.5"
            style={{ color: 'var(--mute2)' }}
          >
            <Link
              href="/"
              className="hover:underline"
              style={{ color: 'var(--text)' }}
            >
              home
            </Link>
            <span>/</span>
            <span style={{ color: 'var(--hi)' }}>account</span>
          </nav>
          <Link href="/" className="ts-13 mono" style={{ color: 'var(--hi)' }}>
            <span style={{ color: 'var(--accent)' }}>§</span> labelhub
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[700px] px-6 py-12">
        <AccountClient
          email={me.email}
          displayName={profile?.displayName ?? null}
          workspaces={myWorkspaces}
          isAdminAnywhere={isAdminAnywhere}
        />
      </main>
    </div>
  )
}
