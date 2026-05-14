import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { optionalUser, requireWorkspaceMember } from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getTemplate } from '@/lib/templates/registry'
import '@/lib/templates/init'
import type { TemplateMode } from '@/lib/templates/types'
import { SettingsClient } from '@/components/workspaces/settings-client'

export const metadata: Metadata = {
  title: 'Workspace settings — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/settings
 *
 * Read-only view for non-admins, editable for admins. Currently exposes:
 *   - Rename workspace (admin)
 *   - Template-mode info (read-only — switching modes mid-stream would
 *     invalidate every annotation's rubric set)
 *   - Workspace id (for support)
 *   - Created date
 *   - Member-count summary
 *
 * Settings that affect billing / tasks / connections live in their own
 * pages; this one is for the workspace shell itself.
 */
export default async function WorkspaceSettingsPage(
  props: PageProps<'/workspaces/[id]/settings'>,
) {
  const { id: workspaceId } = await props.params

  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${workspaceId}/settings`)

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  const { role } = await requireWorkspaceMember(workspaceId)
  const isAdmin = role === 'admin' || workspace.adminId === me.id

  const template = getTemplate(workspace.templateMode as TemplateMode)

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
            <span style={{ color: 'var(--hi)' }}>settings</span>
          </nav>
          <Link href="/" className="ts-13 mono" style={{ color: 'var(--hi)' }}>
            <span style={{ color: 'var(--accent)' }}>§</span> labelhub
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[800px] px-6 py-8">
        <div className="mb-8">
          <div className="lbl mb-2">§ SETTINGS</div>
          <h1 className="ts-32" style={{ color: 'var(--hi)' }}>
            Workspace settings
          </h1>
          <p className="ts-13 mt-1" style={{ color: 'var(--mute)' }}>
            {isAdmin
              ? 'Editable fields are open. Template mode and ids are immutable.'
              : 'Read-only — workspace admins can change these.'}
          </p>
        </div>

        <SettingsClient
          workspaceId={workspaceId}
          initialName={workspace.name}
          templateMode={workspace.templateMode}
          templateLabel={template?.name ?? workspace.templateMode}
          templateDescription={template?.description ?? ''}
          createdAt={workspace.createdAt}
          isAdmin={isAdmin}
        />
      </main>
    </div>
  )
}
