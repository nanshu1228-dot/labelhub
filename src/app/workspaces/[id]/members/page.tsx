import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import {
  listWorkspaceMembers,
  listPendingInvites,
} from '@/lib/actions/membership'
import { optionalUser, requireWorkspaceMember } from '@/lib/auth/guards'
import {
  getWorkspaceTrust,
  type UserTrust,
} from '@/lib/queries/trust-consensus'
import {
  getWorkspaceCalibration,
  type UserCalibration,
} from '@/lib/queries/gold-standards'
import {
  getWorkspaceInviteFunnel,
  listManualReviewRewards,
  type InviteFunnel,
  type ManualReviewRow,
} from '@/lib/queries/invite-rewards'
import { MembersClient } from '@/components/workspaces/members-client'
import { InviteFunnelPanel } from '@/components/workspaces/invite-funnel-panel'

export const metadata: Metadata = {
  title: 'Members — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/members
 *
 * Workspace member roster + invite flow. Server-rendered:
 *   - resolves current user (redirects to sign-in if absent)
 *   - asserts membership (any role can see the roster — read-only for
 *     annotators/viewers; admins get write actions on the client)
 *   - loads members + pending invites in parallel
 *
 * The client component handles all mutations: invite, change role,
 * remove, resend/revoke invite.
 */
export default async function MembersPage(
  props: PageProps<'/workspaces/[id]/members'>,
) {
  const { id: workspaceId } = await props.params

  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${workspaceId}/members`)

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  // Will throw ForbiddenError if user isn't a member; Next.js error boundary
  // catches; surfaced as a 500. Acceptable — visitors of the wrong workspace
  // shouldn't even see the path exists.
  const { role } = await requireWorkspaceMember(workspaceId)
  const isAdmin = role === 'admin' || workspace.adminId === me.id

  // Trust + calibration scores are admin-only operational data — only fetch
  // when the viewer can see them. Saves the workspace-wide scans for non-admins.
  const [
    members,
    pendingInvites,
    trustList,
    calibrationList,
    inviteFunnel,
    manualReviewQueue,
  ] = await Promise.all([
    listWorkspaceMembers(workspaceId),
    isAdmin
      ? listPendingInvites(workspaceId).catch(() => [])
      : Promise.resolve([]),
    isAdmin
      ? getWorkspaceTrust(workspaceId).catch(() => [] as UserTrust[])
      : Promise.resolve([] as UserTrust[]),
    isAdmin
      ? getWorkspaceCalibration(workspaceId).catch(
          () => [] as UserCalibration[],
        )
      : Promise.resolve([] as UserCalibration[]),
    isAdmin
      ? getWorkspaceInviteFunnel(workspaceId).catch(
          () =>
            ({
              invited: 0,
              joined: 0,
              completed: 0,
              granted: 0,
              pendingReview: 0,
              blocked: 0,
              grantedByCurrency: {},
            }) as InviteFunnel,
        )
      : Promise.resolve(null),
    isAdmin
      ? listManualReviewRewards(workspaceId).catch(
          () => [] as ManualReviewRow[],
        )
      : Promise.resolve([] as ManualReviewRow[]),
  ])

  // Serialize lists into plain {userId → row} records so the client component
  // receives serializable props. Empty for non-admins.
  const trustByUserId: Record<string, UserTrust> = {}
  for (const t of trustList) trustByUserId[t.userId] = t
  const calibrationByUserId: Record<string, UserCalibration> = {}
  for (const c of calibrationList) calibrationByUserId[c.userId] = c

  return (
    <div className="app-light min-h-screen" style={{ background: 'var(--bg)' }}>
      <header
        className="hairline-b sticky top-0 z-10"
        style={{ background: 'var(--panel)' }}
      >
        <div className="mx-auto max-w-[1200px] flex items-center justify-between px-6 py-3">
          <nav
            className="ts-12 mono flex items-center gap-1.5 min-w-0"
            style={{ color: 'var(--mute2)' }}
          >
            <Link
              href={`/workspaces/${workspaceId}`}
              className="truncate-1 hover:underline"
              style={{ color: 'var(--text)', maxWidth: 200 }}
            >
              {workspace.name}
            </Link>
            <span>/</span>
            <span style={{ color: 'var(--hi)' }}>members</span>
          </nav>
          <Link href="/" className="ts-13 mono" style={{ color: 'var(--hi)' }}>
            <span style={{ color: 'var(--accent)' }}>§</span> labelhub
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1000px] px-6 py-8">
        <div className="mb-8">
          <div className="lbl mb-2">§ MEMBERS</div>
          <h1 className="ts-32" style={{ color: 'var(--hi)' }}>
            Who has access
          </h1>
          <p className="ts-13 mt-1" style={{ color: 'var(--mute)' }}>
            {isAdmin
              ? "Invite by email. Change roles or remove from the list below. The workspace creator can't be demoted."
              : 'Read-only — workspace admins can change this roster.'}
          </p>
        </div>

        <MembersClient
          workspaceId={workspaceId}
          workspaceCreatorId={workspace.adminId}
          myUserId={me.id}
          isAdmin={isAdmin}
          members={members}
          pendingInvites={pendingInvites}
          trustByUserId={trustByUserId}
          calibrationByUserId={calibrationByUserId}
        />

        {/* Phase-13: invite-reward funnel + manual-review queue.
            Admin-only; presence of `inviteFunnel` is the gate. */}
        {isAdmin && inviteFunnel && (
          <InviteFunnelPanel
            funnel={inviteFunnel}
            queue={manualReviewQueue}
          />
        )}
      </main>
    </div>
  )
}
