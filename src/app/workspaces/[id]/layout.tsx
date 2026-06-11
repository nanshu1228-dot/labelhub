import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { getWorkspaceChrome } from '@/lib/queries/workspace-chrome'
import { isFocusMode, visibleWorkspaceSections } from '@/lib/workspace-nav'
import { WorkspaceSubnav } from '@/components/workspaces/workspace-subnav'

/**
 * /workspaces/[id]/* layout.
 *
 * Adds the persistent in-workspace nav spine (breadcrumb + section
 * tabs) under the global AppHeader that the parent /workspaces layout
 * already mounts. The sections shown respect focus mode + the
 * workspace's template mode, so this stays in lockstep with the
 * cockpit tile grid (both read lib/workspace-nav).
 *
 * Auth: anonymous visitors are redirected here, in the layout. The
 * pages also redirect, but they render inside the segment's loading
 * boundary, so their redirect ships in-band after a 200 shell has
 * already streamed — the layout is the last place a real 30x can
 * still be emitted, and nothing workspace-scoped may flush before it.
 *
 * If the workspace can't be resolved for this member (not a member,
 * bad id, DB down) we render children without the sub-nav — the
 * page's own guard owns the 404, and chrome should never be the
 * thing that crashes the route.
 */
export default async function WorkspaceIdLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${id}`)
  const ws = await getWorkspaceChrome(id, me.id)

  if (!ws) return <>{children}</>

  const focus = isFocusMode()
  const sections = visibleWorkspaceSections(ws.templateMode, focus).map((s) => ({
    key: s.key,
    label: s.label,
    path: s.path,
  }))

  return (
    <>
      <WorkspaceSubnav
        workspaceId={id}
        workspaceName={ws.name}
        sections={sections}
      />
      {children}
    </>
  )
}
