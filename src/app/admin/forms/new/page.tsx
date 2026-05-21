import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { getAdminDashboardData } from '@/lib/queries/admin-dashboard'
import { DesignerShell } from '@/components/form-designer/designer-shell'

export const metadata: Metadata = {
  title: 'New Form · Designer — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /admin/forms/new — Finals P1 entry point for the Designer.
 *
 * Access mirrors the rest of /admin: must be signed in AND admin of at
 * least one workspace. Anyone else gets a 404 (don't leak the surface).
 *
 * D2 ships a minimal shell with a two-button palette + sortable canvas
 * + label-editor properties pane. D3-D6 fill in the 9-material library,
 * proper property panels, persistence, and the Renderer wiring.
 *
 * The route is workspace-less in D2 because no persistence is wired
 * yet. D6 will move this to /workspaces/[id]/forms/new and bind saved
 * schemas to a workspace_id column on custom_form_schemas.
 */
export default async function NewFormPage() {
  const me = await optionalUser()
  if (!me) redirect('/signin?next=/admin/forms/new')

  // Same admin gate as /admin: must run at least one workspace.
  const dashboard = await getAdminDashboardData({ userId: me.id })
  if (dashboard.cards.length === 0) notFound()

  return <DesignerShell />
}
