'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updateProfile } from '@/lib/actions/membership'

/**
 * Account page client.
 *
 * Two sections + a sign-out button:
 *   1. Profile — email (read-only) + display name (editable, debounced save
 *      on blur, also has a "Save" button for explicit commit)
 *   2. Workspaces — list of memberships with role pill + link to each
 *
 * Email + display name are loaded from the SSR `users` row; sign-out goes
 * through the existing /signout route handler.
 */

type Role = 'admin' | 'annotator' | 'viewer'

interface WorkspaceMembership {
  workspaceId: string
  workspaceName: string
  role: Role
  joinedAt: Date
}

export function AccountClient({
  email,
  displayName,
  workspaces,
}: {
  email: string
  displayName: string | null
  workspaces: WorkspaceMembership[]
}) {
  return (
    <div className="space-y-10">
      <div>
        <div className="lbl">§ ACCOUNT</div>
        <h1 className="ts-32 mt-1" style={{ color: 'var(--hi)' }}>
          Your profile
        </h1>
      </div>

      <ProfileSection email={email} initialDisplayName={displayName} />

      <WorkspacesSection workspaces={workspaces} />

      <SignOutCard />
    </div>
  )
}

function ProfileSection({
  email,
  initialDisplayName,
}: {
  email: string
  initialDisplayName: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function save() {
    setError(null)
    setInfo(null)
    const trimmed = displayName.trim()
    startTransition(async () => {
      try {
        await updateProfile({
          displayName: trimmed.length > 0 ? trimmed : null,
        })
        setInfo('Saved.')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed.')
      }
    })
  }

  const changed = (displayName.trim() || null) !== initialDisplayName

  return (
    <section>
      <div className="lbl mb-3">PROFILE</div>
      <div
        className="rounded-xl p-5 space-y-4"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
      >
        <Field label="Email" hint="Provided by your auth provider — read-only here.">
          <div
            className="mono ts-13 px-3 py-2 rounded-md"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
            }}
          >
            {email}
          </div>
        </Field>

        <Field
          label="Display name"
          hint="Shown to teammates on members lists, mark attribution, and dispute logs."
        >
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={60}
            placeholder="(blank = email prefix)"
            className="w-full px-3 py-2 ts-13 rounded-md"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
              outline: 'none',
            }}
          />
        </Field>

        {error && (
          <div
            className="ts-12 rounded-md p-2"
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid oklch(0.55 0.2 25 / 0.35)',
              color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        )}
        {info && (
          <div
            className="ts-12 rounded-md p-2"
            style={{
              background: 'var(--success-soft)',
              border: '1px solid oklch(0.5 0.13 150 / 0.35)',
              color: 'var(--success)',
            }}
          >
            {info}
          </div>
        )}

        <div className="flex items-center justify-end">
          <button
            onClick={save}
            disabled={isPending || !changed}
            className="ts-13 mono"
            style={{
              background: changed ? 'var(--accent)' : 'var(--panel2)',
              color: changed ? 'white' : 'var(--mute2)',
              border: `1px solid ${changed ? 'var(--accent)' : 'var(--line)'}`,
              borderRadius: 6,
              padding: '8px 16px',
              fontWeight: 500,
              cursor: isPending || !changed ? 'not-allowed' : 'pointer',
            }}
          >
            {isPending ? 'saving…' : 'save'}
          </button>
        </div>
      </div>
    </section>
  )
}

function WorkspacesSection({
  workspaces,
}: {
  workspaces: WorkspaceMembership[]
}) {
  return (
    <section>
      <div className="lbl mb-3">YOUR WORKSPACES · {workspaces.length}</div>
      {workspaces.length === 0 ? (
        <div
          className="rounded-xl p-6 text-center"
          style={{
            background: 'var(--panel)',
            border: '1px dashed var(--line2)',
          }}
        >
          <h3 className="ts-16" style={{ color: 'var(--hi)', fontWeight: 500 }}>
            You&apos;re not in any workspaces yet
          </h3>
          <p
            className="ts-13 mt-2 mx-auto"
            style={{ color: 'var(--mute)', maxWidth: 380 }}
          >
            Create a new one, or accept an invite from a teammate.
          </p>
          <Link
            href="/workspaces/new"
            className="lh-btn inline-flex mt-4"
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
            Start a workspace →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {workspaces.map((w) => (
            <Link
              key={w.workspaceId}
              href={`/workspaces/${w.workspaceId}`}
              className="block rounded-md p-3"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                textDecoration: 'none',
                transition: 'border-color 120ms',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div
                    className="ts-14 trunc-1"
                    style={{ color: 'var(--hi)', fontWeight: 500 }}
                  >
                    {w.workspaceName}
                  </div>
                  <div
                    className="mono ts-11 mt-0.5"
                    style={{ color: 'var(--mute2)' }}
                  >
                    {w.workspaceId.slice(0, 8)} · joined{' '}
                    {w.joinedAt.toISOString().slice(0, 10)}
                  </div>
                </div>
                <RoleTag role={w.role} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

function SignOutCard() {
  return (
    <section>
      <div className="lbl mb-3" style={{ color: 'var(--danger)' }}>
        SESSION
      </div>
      <div
        className="rounded-xl p-4 flex items-center justify-between"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <div className="min-w-0">
          <div className="ts-13" style={{ color: 'var(--hi)', fontWeight: 500 }}>
            Sign out of LabelHub
          </div>
          <div className="ts-12 mt-1" style={{ color: 'var(--mute)' }}>
            Clears the Supabase session cookie for this browser. Workspaces
            you&apos;re a member of remain — you just have to sign in again.
          </div>
        </div>
        <form action="/signout" method="post" className="shrink-0">
          <button
            type="submit"
            className="ts-13 mono"
            style={{
              background: 'transparent',
              border: '1px solid oklch(0.55 0.2 25 / 0.35)',
              borderRadius: 6,
              padding: '8px 14px',
              color: 'var(--danger)',
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="lbl mb-1.5">{label}</div>
      {children}
      {hint && (
        <div className="ts-11 mt-1.5" style={{ color: 'var(--mute2)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}

function RoleTag({ role }: { role: Role }) {
  const palette: Record<Role, { bg: string; fg: string; border: string }> = {
    admin: {
      bg: 'var(--accent-soft)',
      fg: 'var(--accent)',
      border: 'var(--accent-line)',
    },
    annotator: {
      bg: 'oklch(0.94 0 0)',
      fg: 'var(--hi)',
      border: 'var(--line)',
    },
    viewer: {
      bg: 'var(--panel2)',
      fg: 'var(--mute)',
      border: 'var(--line)',
    },
  }
  const v = palette[role]
  return (
    <span
      className="mono ts-11 shrink-0"
      style={{
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.border}`,
        padding: '2px 8px',
        borderRadius: 4,
      }}
    >
      {role}
    </span>
  )
}
