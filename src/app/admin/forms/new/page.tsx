import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { getAdminDashboardData } from '@/lib/queries/admin-dashboard'
import { DesignerShell } from '@/components/form-designer/designer-shell'
import {
  createCustomFormSchema,
  updateCustomFormSchema,
} from '@/lib/form-designer/storage'
import { OFFICIAL_TEMPLATES } from '@/lib/form-designer/templates'

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
 * D6 wires save: the workspaces a Labeler can target appear in the
 * Designer's Save dialog. Storage server actions are forwarded into the
 * client component so the canvas atom (Jotai) can call them from the
 * toolbar without owning the auth check.
 */
export default async function NewFormPage() {
  const me = await optionalUser()
  if (!me) redirect('/signin?next=/admin/forms/new')

  // Same admin gate as /admin: must run at least one workspace.
  const dashboard = await getAdminDashboardData({ userId: me.id })
  if (dashboard.cards.length === 0) notFound()

  const workspaceOptions = dashboard.cards.map((c) => ({
    id: c.workspaceId,
    name: c.name,
  }))

  // D19-C — pass the curated official template list into the
  // Designer so PMs can start from a pre-built schema instead of a
  // blank canvas. We drop the AI-dimensions payload here; the
  // dropdown only needs id/label/description/schema.
  const templateOptions = OFFICIAL_TEMPLATES.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    schema: t.schema,
  }))

  return (
    <DesignerShell
      workspaces={workspaceOptions}
      templates={templateOptions}
      storage={{
        save: createCustomFormSchema,
        update: updateCustomFormSchema,
      }}
    />
  )
}
