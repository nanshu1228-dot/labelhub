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

type Role = 'admin' | 'qc' | 'annotator' | 'viewer'

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

      {workspaces.length > 0 && (
        <>
          <QueueCTA />
          <QuickLinksRow />
        </>
      )}

      <ProfileSection email={email} initialDisplayName={displayName} />

      <WorkspacesSection workspaces={workspaces} />

      <SignOutCard />
    </div>
  )
}

/**
 * Big-action card pointing the user at /my/queue. Top of the account
 * page when they're a member of any workspace — the actual daily
 * "what should I work on" surface. Skipped for users with zero
 * memberships (the empty-state below is their starting point).
 */
/**
 * Quick-access row under the queue CTA. Points to the two secondary
 * annotator-facing pages: submission history and earnings. Both are
 * read-only personal views, useful from the account hub.
 */
function QuickLinksRow() {
  const links = [
    {
      href: '/my/submissions',
      label: 'My submissions',
      hint: 'work history · approve / reject / 打回',
    },
    {
      href: '/my/earnings',
      label: 'My earnings',
      hint: 'pending + paid · per-period breakdown',
    },
  ]
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 -mt-4">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="block rounded-md p-3"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            textDecoration: 'none',
            transition: 'border-color 120ms',
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="ts-13"
              style={{ color: 'var(--hi)', fontWeight: 500 }}
            >
              {l.label}
            </span>
            <span
              className="ts-13 mono"
              style={{ color: 'var(--mute2)' }}
              aria-hidden
            >
              →
            </span>
          </div>
          <p
            className="ts-12 mono mt-0.5"
            style={{ color: 'var(--mute2)' }}
          >
            {l.hint}
          </p>
        </Link>
      ))}
    </div>
  )
}

function QueueCTA() {
  return (
    <Link
      href="/my/queue"
      className="block rounded-xl p-5"
      style={{
        background:
          'linear-gradient(135deg, var(--accent-soft), oklch(0.95 0.04 280 / 0.5))',
        border: '1px solid var(--accent-line)',
        textDecoration: 'none',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="lbl" style={{ color: 'var(--accent)' }}>
            § ANNOTATE
          </div>
          <h3
            className="ts-18 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            Open my queue
          </h3>
          <p
            className="ts-13 mt-1"
            style={{ color: 'var(--mute)', maxWidth: 480 }}
          >
            See ranked trajectories waiting for your review across every
            workspace you&apos;re in — disputes first.
          </p>
        </div>
        <span
          className="ts-24"
          style={{ color: 'var(--accent)' }}
          aria-hidden="true"
        >
          →
        </span>
      </div>
    </Link>
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
        <EmptyWorkspacesState />
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

/**
 * First-time empty state. Two cards side-by-side:
 *   1. "Tour the demo workspace" — links straight to the seeded org so
 *      a brand-new user can see what the product DOES before committing
 *      to creating their own. Read-only-friendly: the dashboard renders
 *      for non-members. Mutations gate on role at the server.
 *   2. "Start your own" — the original CTA, slightly smaller / secondary.
 *
 * Demo workspace id is hardcoded — it's the one seed-rich-demo populates.
 * If the seed changes, update the constant in both places.
 */
const DEMO_WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'

function EmptyWorkspacesState() {
  return (
    <div
      className="rounded-xl p-6"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line2)',
      }}
    >
      <h3
        className="ts-16 text-center"
        style={{ color: 'var(--hi)', fontWeight: 500 }}
      >
        You&apos;re not in any workspaces yet
      </h3>
      <p
        className="ts-13 mt-2 mx-auto text-center"
        style={{ color: 'var(--mute)', maxWidth: 440 }}
      >
        Two ways in: tour the demo to see what LabelHub does, or stand up
        your own workspace and invite teammates.
      </p>
      <div
        className="grid gap-3 mt-5"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          maxWidth: 720,
          margin: '20px auto 0',
        }}
      >
        <OnboardingCard
          tag="RECOMMENDED"
          title="Tour the demo workspace"
          body="30 trajectories, 3 raters, real disputes + gold standards already wired. Click around and see how the pieces fit."
          href={`/workspaces/${DEMO_WORKSPACE_ID}`}
          accent
        />
        <OnboardingCard
          tag="OPTIONAL"
          title="Start your own workspace"
          body="Create an empty workspace, capture your first agent run through the proxy, then invite teammates to rate."
          href="/workspaces/new"
        />
      </div>
    </div>
  )
}

function OnboardingCard({
  tag,
  title,
  body,
  href,
  accent,
}: {
  tag: string
  title: string
  body: string
  href: string
  accent?: boolean
}) {
  return (
    <Link
      href={href as `/${string}`}
      className="block rounded-lg p-4"
      style={{
        background: accent ? 'var(--accent-soft)' : 'var(--bg)',
        border: `1px solid ${accent ? 'var(--accent-line)' : 'var(--line)'}`,
        textDecoration: 'none',
        transition: 'border-color 120ms, transform 120ms',
      }}
    >
      <div
        className="lbl"
        style={{
          color: accent ? 'var(--accent)' : 'var(--mute2)',
          letterSpacing: '0.05em',
        }}
      >
        {tag}
      </div>
      <div
        className="ts-14 mt-1"
        style={{
          color: 'var(--hi)',
          fontWeight: 500,
        }}
      >
        {title} <span style={{ color: 'var(--mute2)' }}>→</span>
      </div>
      <p
        className="ts-12 mt-1.5"
        style={{ color: 'var(--mute)', lineHeight: 1.5 }}
      >
        {body}
      </p>
    </Link>
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
    qc: {
      bg: 'oklch(0.94 0.04 200 / 0.5)',
      fg: 'oklch(0.45 0.15 200)',
      border: 'oklch(0.6 0.15 200 / 0.3)',
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
