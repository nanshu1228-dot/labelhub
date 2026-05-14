'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  inviteToWorkspace,
  changeMemberRole,
  removeMember,
  resendInvite,
  revokeInvite,
} from '@/lib/actions/membership'
import type { UserTrust } from '@/lib/queries/trust-consensus'
import { TrustBadge } from '@/components/quality/trust-badge'

/**
 * Client-side membership management UI.
 *
 * Two sections:
 *
 *   1. Members — the active roster. Admins see role dropdowns + remove
 *      buttons; non-admins see a read-only table. The "self" row is always
 *      disabled (avoid accidental self-removal).
 *
 *   2. Pending invites — only admins. Each row has "copy link", "resend
 *      email" (if a real EmailSender is configured), "revoke".
 *
 * All mutations go through Server Actions; on success we `router.refresh()`
 * so the SSR loader re-runs.
 */

type Role = 'admin' | 'annotator' | 'viewer'

interface Member {
  userId: string
  email: string
  displayName: string | null
  role: Role
  joinedAt: Date
}

interface PendingInvite {
  id: string
  email: string
  role: Role
  token: string
  inviteUrl: string
  invitedBy: string
  inviterEmail: string | null
  createdAt: Date
  expiresAt: Date | null
}

export function MembersClient({
  workspaceId,
  workspaceCreatorId,
  myUserId,
  isAdmin,
  members,
  pendingInvites,
  trustByUserId,
}: {
  workspaceId: string
  workspaceCreatorId: string
  myUserId: string
  isAdmin: boolean
  members: Member[]
  pendingInvites: PendingInvite[]
  trustByUserId: Record<string, UserTrust>
}) {
  return (
    <div className="space-y-10">
      {isAdmin && <InviteForm workspaceId={workspaceId} />}

      <section>
        <div className="lbl mb-3">
          ACTIVE MEMBERS · {members.length}
        </div>
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          <table className="w-full ts-13">
            <thead
              style={{
                color: 'var(--mute2)',
                borderBottom: '1px solid var(--line)',
                fontSize: 11,
                fontFamily: 'var(--font-geist-mono), monospace',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              <tr>
                <th className="text-left p-3">member</th>
                <th className="text-left p-3">role</th>
                <th className="text-left p-3">trust</th>
                <th className="text-left p-3">joined</th>
                <th className="text-right p-3"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <MemberRow
                  key={m.userId}
                  member={m}
                  workspaceId={workspaceId}
                  isAdmin={isAdmin}
                  isMe={m.userId === myUserId}
                  isCreator={m.userId === workspaceCreatorId}
                  trust={trustByUserId[m.userId] ?? null}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {isAdmin && (
        <section>
          <div className="lbl mb-3">
            PENDING INVITES · {pendingInvites.length}
          </div>
          {pendingInvites.length === 0 ? (
            <p className="ts-13" style={{ color: 'var(--mute)' }}>
              No outstanding invites. Use the form above to send a new one.
            </p>
          ) : (
            <div className="space-y-2">
              {pendingInvites.map((inv) => (
                <PendingInviteRow
                  key={inv.id}
                  invite={inv}
                  workspaceId={workspaceId}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

// ─── Invite form ───────────────────────────────────────────────────────

function InviteForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('annotator')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{
    inviteUrl?: string
    emailSent: boolean
    emailRateLimited: boolean
    emailError?: string
    mode: 'member-created' | 'invite-pending'
  } | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        const r = await inviteToWorkspace({ workspaceId, email, role })
        setSuccess({
          inviteUrl: r.inviteUrl,
          emailSent: r.emailSent ?? false,
          emailRateLimited: r.emailRateLimited ?? false,
          emailError: r.emailError,
          mode: r.mode,
        })
        setEmail('')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invite failed.')
      }
    })
  }

  return (
    <section>
      <div className="lbl mb-3">INVITE</div>
      <form
        onSubmit={submit}
        className="rounded-xl p-4 flex flex-col gap-3"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <div className="flex items-end gap-2 flex-wrap">
          <label className="flex-1 min-w-[240px]">
            <span className="lbl mb-1.5 block">email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="w-full px-3 py-2 ts-13 rounded-md"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
                outline: 'none',
              }}
            />
          </label>
          <label>
            <span className="lbl mb-1.5 block">role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="px-3 py-2 ts-13 rounded-md mono"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
                minWidth: 130,
              }}
            >
              <option value="annotator">annotator</option>
              <option value="admin">admin</option>
              <option value="viewer">viewer</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={isPending || !email}
            className="ts-13 mono"
            style={{
              background: 'var(--accent)',
              color: 'white',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              padding: '8px 16px',
              fontWeight: 500,
              cursor: isPending || !email ? 'not-allowed' : 'pointer',
              opacity: isPending || !email ? 0.5 : 1,
            }}
          >
            {isPending ? 'sending…' : 'send invite'}
          </button>
        </div>
        <RoleMatrix />
        {error && (
          <div
            className="rounded-md p-2.5 ts-12"
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid oklch(0.55 0.2 25 / 0.35)',
              color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        )}
        {success && <InviteSuccessCard success={success} />}
      </form>
    </section>
  )
}

function InviteSuccessCard({
  success,
}: {
  success: {
    inviteUrl?: string
    emailSent: boolean
    emailRateLimited: boolean
    emailError?: string
    mode: 'member-created' | 'invite-pending'
  }
}) {
  const [copied, setCopied] = useState(false)

  if (success.mode === 'member-created') {
    return (
      <div
        className="rounded-md p-3 ts-12"
        style={{
          background: 'var(--success-soft)',
          border: '1px solid oklch(0.5 0.13 150 / 0.35)',
          color: 'var(--success)',
        }}
      >
        Added directly — the invitee already had an account.
      </div>
    )
  }

  function copy() {
    if (!success.inviteUrl) return
    void navigator.clipboard.writeText(success.inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const isWarn = !success.emailSent
  return (
    <div
      className="rounded-md p-3 ts-12 space-y-2"
      style={{
        background: isWarn ? 'var(--warn-soft)' : 'var(--success-soft)',
        border: isWarn
          ? '1px solid oklch(0.6 0.14 75 / 0.4)'
          : '1px solid oklch(0.5 0.13 150 / 0.35)',
        color: isWarn ? 'var(--warn)' : 'var(--success)',
      }}
    >
      <div>
        {success.emailSent ? (
          <>
            <strong>Email sent.</strong> Supabase queued a magic-link to that
            address — the recipient clicks it, signs in (account auto-created
            if needed), then lands on the accept page. The same link is below
            if you want to relay it directly.
          </>
        ) : success.emailRateLimited ? (
          <>
            <strong>Rate limited.</strong> Supabase&apos;s free tier caps magic
            links at ~4/hour per recipient. The invite row was still created —
            copy the link below to deliver this one out-of-band, or try again
            in an hour.
          </>
        ) : (
          <>
            <strong>Email send failed</strong>
            {success.emailError ? ` (${success.emailError})` : ''} — the
            invite row was created, and the link below still works.
          </>
        )}
      </div>
      {success.inviteUrl && (
        <div className="flex items-center gap-2">
          <code
            className="mono flex-1 min-w-0 px-2 py-1 rounded"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
              fontSize: 11,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {success.inviteUrl}
          </code>
          <button
            type="button"
            onClick={copy}
            className="ts-11 mono shrink-0"
            style={{
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 5,
              padding: '4px 10px',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {copied ? 'copied ✓' : 'copy'}
          </button>
        </div>
      )}
    </div>
  )
}

function RoleMatrix() {
  return (
    <div
      className="ts-11 mono"
      style={{ color: 'var(--mute2)', lineHeight: 1.6 }}
    >
      <strong style={{ color: 'var(--mute)' }}>roles:</strong>{' '}
      <span style={{ color: 'var(--accent)' }}>admin</span> can manage members,
      keys, scope, billing ·{' '}
      <span style={{ color: 'var(--text)' }}>annotator</span> can score
      trajectories + submit comparisons ·{' '}
      <span style={{ color: 'var(--mute)' }}>viewer</span> read-only.
    </div>
  )
}

// ─── Member row ────────────────────────────────────────────────────────

function MemberRow({
  member,
  workspaceId,
  isAdmin,
  isMe,
  isCreator,
  trust,
}: {
  member: Member
  workspaceId: string
  isAdmin: boolean
  isMe: boolean
  isCreator: boolean
  trust: UserTrust | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const editable = isAdmin && !isMe && !isCreator

  function changeRole(newRole: Role) {
    setError(null)
    startTransition(async () => {
      try {
        await changeMemberRole({
          workspaceId,
          userId: member.userId,
          role: newRole,
        })
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Update failed.')
      }
    })
  }

  function remove() {
    if (
      !confirm(
        `Remove ${member.displayName || member.email} from this workspace?`,
      )
    )
      return
    setError(null)
    startTransition(async () => {
      try {
        await removeMember({ workspaceId, userId: member.userId })
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Remove failed.')
      }
    })
  }

  return (
    <>
      <tr style={{ borderTop: '1px solid var(--line)' }}>
        <td className="p-3">
          <div style={{ color: 'var(--hi)', fontWeight: 500 }}>
            {member.displayName || member.email.split('@')[0]}
            {isMe && (
              <span
                className="ts-11 mono ml-2"
                style={{
                  color: 'var(--accent)',
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent-line)',
                  padding: '1px 6px',
                  borderRadius: 4,
                }}
              >
                you
              </span>
            )}
            {isCreator && (
              <span
                className="ts-11 mono ml-2"
                style={{
                  color: 'var(--warn)',
                  background: 'var(--warn-soft)',
                  border: '1px solid oklch(0.6 0.14 75 / 0.4)',
                  padding: '1px 6px',
                  borderRadius: 4,
                }}
              >
                creator
              </span>
            )}
          </div>
          <div
            className="mono mt-0.5"
            style={{ fontSize: 11, color: 'var(--mute2)' }}
          >
            {member.email}
          </div>
        </td>
        <td className="p-3">
          {editable ? (
            <select
              value={member.role}
              onChange={(e) => changeRole(e.target.value as Role)}
              disabled={isPending}
              className="px-2 py-1 ts-12 mono rounded"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
              }}
            >
              <option value="admin">admin</option>
              <option value="annotator">annotator</option>
              <option value="viewer">viewer</option>
            </select>
          ) : (
            <RoleTag role={member.role} />
          )}
        </td>
        <td className="p-3">
          <TrustBadge trust={trust} size="md" />
        </td>
        <td className="p-3 mono" style={{ color: 'var(--mute2)', fontSize: 12 }}>
          {member.joinedAt.toISOString().slice(0, 10)}
        </td>
        <td className="p-3 text-right">
          {editable && (
            <button
              onClick={remove}
              disabled={isPending}
              className="ts-11 mono"
              style={{
                background: 'transparent',
                border: '1px solid oklch(0.55 0.2 25 / 0.35)',
                borderRadius: 5,
                padding: '4px 10px',
                color: 'var(--danger)',
                cursor: isPending ? 'not-allowed' : 'pointer',
              }}
            >
              remove
            </button>
          )}
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={5} className="px-3 pb-2">
            <div
              className="ts-11 mono"
              style={{ color: 'var(--danger)' }}
            >
              {error}
            </div>
          </td>
        </tr>
      )}
    </>
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
      className="mono ts-12"
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

// ─── Pending invite row ────────────────────────────────────────────────

function PendingInviteRow({
  invite,
  workspaceId: _workspaceId,
}: {
  invite: PendingInvite
  workspaceId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  function copy() {
    void navigator.clipboard.writeText(invite.inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function resend() {
    setError(null)
    setStatus(null)
    startTransition(async () => {
      try {
        const r = await resendInvite({ inviteId: invite.id })
        setStatus(
          r.emailSent
            ? 'Email re-sent via Supabase magic link.'
            : r.emailRateLimited
              ? 'Rate-limited (~4/hour per recipient). Copy the link instead.'
              : `Email send failed${r.emailError ? ' — ' + r.emailError : ''}. Copy the link instead.`,
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Resend failed.')
      }
    })
  }

  function revoke() {
    if (!confirm(`Revoke the invite to ${invite.email}?`)) return
    setError(null)
    startTransition(async () => {
      try {
        await revokeInvite({ inviteId: invite.id })
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Revoke failed.')
      }
    })
  }

  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className="mono ts-12 trunc-1"
            style={{ color: 'var(--text)', minWidth: 0 }}
          >
            {invite.email}
          </span>
          <RoleTag role={invite.role} />
          <span
            className="ts-11 mono"
            style={{ color: 'var(--mute2)' }}
          >
            invited {invite.createdAt.toISOString().slice(0, 10)}
            {invite.expiresAt &&
              ` · expires ${invite.expiresAt.toISOString().slice(0, 10)}`}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={copy}
            className="ts-11 mono"
            style={{
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 5,
              padding: '4px 10px',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {copied ? 'copied ✓' : 'copy link'}
          </button>
          <button
            onClick={resend}
            disabled={isPending}
            className="ts-11 mono"
            style={{
              background: 'transparent',
              border: '1px solid var(--accent-line)',
              borderRadius: 5,
              padding: '4px 10px',
              color: 'var(--accent)',
              cursor: isPending ? 'not-allowed' : 'pointer',
            }}
          >
            resend email
          </button>
          <button
            onClick={revoke}
            disabled={isPending}
            className="ts-11 mono"
            style={{
              background: 'transparent',
              border: '1px solid oklch(0.55 0.2 25 / 0.35)',
              borderRadius: 5,
              padding: '4px 10px',
              color: 'var(--danger)',
              cursor: isPending ? 'not-allowed' : 'pointer',
            }}
          >
            revoke
          </button>
        </div>
      </div>
      {(status || error) && (
        <div
          className="ts-11 mono mt-2"
          style={{ color: error ? 'var(--danger)' : 'var(--mute)' }}
        >
          {error || status}
        </div>
      )}
    </div>
  )
}
