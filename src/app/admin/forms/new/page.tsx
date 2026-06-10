import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { getAdminDashboardData } from '@/lib/queries/admin-dashboard'
import { DesignerShell } from '@/components/form-designer/designer-shell'
import {
  createCustomFormSchema,
  listWorkspaceTemplates,
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

  // D19-C — official starter templates.
  // D21-B — also surface workspace-saved templates (flag
  // `customFormSchemas.isTemplate=true`) so the PM can iterate on
  // their own conventions across forms. Fetch in parallel across
  // every workspace the user admins; tag each entry with `Workspace:`
  // prefix so the dropdown distinguishes official from workspace.
  const workspaceTemplateLists = await Promise.all(
    dashboard.cards.map((c) =>
      listWorkspaceTemplates({ workspaceId: c.workspaceId }).catch(
        () => [],
      ),
    ),
  )
  const workspaceTemplateOptions = workspaceTemplateLists.flatMap(
    (rows, idx) => {
      const ws = dashboard.cards[idx]
      return rows.map((r) => ({
        id: `ws:${r.id}`,
        label: `${ws.name} · ${r.label}`,
        description: `Workspace template (v${r.version})`,
        schema: r.schema,
      }))
    },
  )

  const templateOptions = [
    ...OFFICIAL_TEMPLATES.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      schema: t.schema,
    })),
    ...workspaceTemplateOptions,
  ]

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
