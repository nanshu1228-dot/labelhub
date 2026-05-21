import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { getAdminDashboardData } from '@/lib/queries/admin-dashboard'
import { DesignerShell } from '@/components/form-designer/designer-shell'
import {
  createCustomFormSchema,
  loadCustomFormSchema,
  updateCustomFormSchema,
} from '@/lib/form-designer/storage'

export const metadata: Metadata = {
  title: 'Edit form · Designer — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /admin/forms/[id] — Finals P1 D6 edit page.
 *
 * Loads a saved schema and seeds the Designer canvas. Owner can
 * tweak fields and click "Update schema" to save back to the same row
 * (storage.update). Save Targets the schema's existing workspace.
 *
 * Visibility: must be admin of the schema's workspace. Anyone else
 * gets 404 (don't leak the schema's existence).
 */
export default async function EditFormPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/admin/forms/${id}`)

  const row = await loadCustomFormSchema({ id })
  if (!row) notFound()

  const dashboard = await getAdminDashboardData({ userId: me.id })
  const adminWorkspaceIds = new Set(dashboard.cards.map((c) => c.workspaceId))
  if (!adminWorkspaceIds.has(row.workspaceId)) notFound()

  const workspaceOptions = dashboard.cards.map((c) => ({
    id: c.workspaceId,
    name: c.name,
  }))

  return (
    <DesignerShell
      workspaces={workspaceOptions}
      initialSchema={{
        id: row.id,
        workspaceId: row.workspaceId,
        label: row.label,
        schema: row.schema,
      }}
      storage={{
        save: createCustomFormSchema,
        update: updateCustomFormSchema,
      }}
    />
  )
}
