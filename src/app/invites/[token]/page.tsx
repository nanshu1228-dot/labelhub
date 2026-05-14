import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { users, workspaceInvites, workspaces } from '@/lib/db/schema'
import { optionalUser } from '@/lib/auth/guards'
import { AcceptInviteClient } from '@/components/workspaces/accept-invite-client'

export const metadata: Metadata = {
  title: 'Accept invite — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /invites/[token]
 *
 * Where invite emails point. We:
 *
 *   1. Resolve token → invite + workspace (joined for the inviter's email).
 *   2. If user isn't signed in → bounce to /signin with this URL as next.
 *   3. If user IS signed in but their email != invite.email → show a
 *      mismatch screen with explicit guidance (sign in as the right account).
 *   4. If user matches → show "Accept invite" button (acceptInvite action).
 *
 * Pre-validation in SSR means the client component only ever sees a
 * "good" invite — accept is unambiguous from there.
 */
export default async function AcceptInvitePage(
  props: PageProps<'/invites/[token]'>,
) {
  const { token } = await props.params

  const db = getDb()
  const [row] = await db
    .select({
      id: workspaceInvites.id,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      acceptedAt: workspaceInvites.acceptedAt,
      expiresAt: workspaceInvites.expiresAt,
      workspaceId: workspaceInvites.workspaceId,
      workspaceName: workspaces.name,
      inviterEmail: users.email,
    })
    .from(workspaceInvites)
    .leftJoin(workspaces, eq(workspaceInvites.workspaceId, workspaces.id))
    .leftJoin(users, eq(workspaceInvites.invitedBy, users.id))
    .where(eq(workspaceInvites.token, token))
    .limit(1)

  // Invalid token → generic message; do NOT leak whether the token shape
  // ever existed (small anti-enumeration measure).
  if (!row) {
    return (
      <InviteShell>
        <h1 className="ts-24" style={{ color: 'var(--hi)', fontWeight: 500 }}>
          This invite link isn&apos;t valid
        </h1>
        <p className="ts-13 mt-3" style={{ color: 'var(--mute)' }}>
          It may have been revoked, already accepted, or never existed. Ask
          the workspace admin to send a new invite.
        </p>
      </InviteShell>
    )
  }

  if (row.acceptedAt) {
    return (
      <InviteShell>
        <h1 className="ts-24" style={{ color: 'var(--hi)', fontWeight: 500 }}>
          Already accepted
        </h1>
        <p className="ts-13 mt-3" style={{ color: 'var(--mute)' }}>
          This invite was already used. If that wasn&apos;t you, ask the
          workspace admin to investigate.
        </p>
        <Link
          href={`/workspaces/${row.workspaceId}`}
          className="lh-btn lh-btn-accent inline-flex mt-4"
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          Open workspace →
        </Link>
      </InviteShell>
    )
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return (
      <InviteShell>
        <h1 className="ts-24" style={{ color: 'var(--hi)', fontWeight: 500 }}>
          This invite has expired
        </h1>
        <p className="ts-13 mt-3" style={{ color: 'var(--mute)' }}>
          Invites are valid for 7 days. Ask the admin to send a new one.
        </p>
      </InviteShell>
    )
  }

  // Auth gate.
  const me = await optionalUser()
  if (!me) {
    redirect(`/signin?next=/invites/${encodeURIComponent(token)}`)
  }

  // Email mismatch.
  if (me.email.toLowerCase() !== row.email.toLowerCase()) {
    return (
      <InviteShell>
        <div className="lbl mb-2" style={{ color: 'var(--warn)' }}>
          EMAIL MISMATCH
        </div>
        <h1 className="ts-24" style={{ color: 'var(--hi)', fontWeight: 500 }}>
          This invite was sent to a different address
        </h1>
        <p className="ts-13 mt-3" style={{ color: 'var(--mute)' }}>
          You&apos;re signed in as{' '}
          <code
            className="mono"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              padding: '1px 6px',
              borderRadius: 4,
              color: 'var(--text)',
            }}
          >
            {me.email}
          </code>{' '}
          but the invite was sent to{' '}
          <code
            className="mono"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              padding: '1px 6px',
              borderRadius: 4,
              color: 'var(--text)',
            }}
          >
            {row.email}
          </code>
          . Sign in with the invited account, or ask the admin to re-send
          the invite to your current address.
        </p>
        <form action="/signout" method="post" className="mt-4">
          <button
            type="submit"
            className="lh-btn"
            style={{
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '8px 14px',
              fontSize: 13,
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </form>
      </InviteShell>
    )
  }

  // Happy path — client renders the accept CTA.
  return (
    <InviteShell>
      <div className="lbl mb-2">§ INVITE</div>
      <h1 className="ts-24" style={{ color: 'var(--hi)', fontWeight: 500 }}>
        Join <em style={{ color: 'var(--accent)' }}>{row.workspaceName}</em>
      </h1>
      <p className="ts-13 mt-3" style={{ color: 'var(--mute)' }}>
        {row.inviterEmail ?? 'A workspace admin'} invited you as{' '}
        <strong style={{ color: 'var(--hi)' }}>{row.role}</strong>.
      </p>

      <AcceptInviteClient
        token={token}
        workspaceId={row.workspaceId}
      />
    </InviteShell>
  )
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-light min-h-screen" style={{ background: 'var(--bg)' }}>
      <header
        style={{
          borderBottom: '1px solid var(--line)',
          background: 'var(--panel)',
        }}
      >
        <div className="mx-auto max-w-[1000px] flex items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="ts-13 mono"
            style={{
              color: 'var(--hi)',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            <span style={{ color: 'var(--accent)' }}>§</span> labelhub
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[500px] px-6 py-20">
        <div
          className="rounded-xl p-8"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
        >
          {children}
        </div>
      </main>
    </div>
  )
}
