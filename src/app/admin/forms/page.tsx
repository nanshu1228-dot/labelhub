import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { getAdminDashboardData } from '@/lib/queries/admin-dashboard'
import { listCustomFormSchemas } from '@/lib/form-designer/storage'

export const metadata: Metadata = {
  title: 'Forms · Designer — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /admin/forms — Finals P1 D6.
 *
 * Index of saved Designer schemas across every workspace this admin
 * owns. From here the admin can:
 *   - jump to /admin/forms/new to author a fresh schema
 *   - click a saved schema → /admin/forms/[id] for edit/preview
 *
 * Mirrors the dashboard's "card per workspace" pattern so admins
 * managing multiple workspaces see them grouped.
 */
export default async function FormsListPage() {
  const me = await optionalUser()
  if (!me) redirect('/signin?next=/admin/forms')

  const dashboard = await getAdminDashboardData({ userId: me.id })
  if (dashboard.cards.length === 0) notFound()

  // Fan out one list query per admin'd workspace. Cheap (count is
  // small) and avoids a fancy join.
  const sections = await Promise.all(
    dashboard.cards.map(async (c) => ({
      workspace: { id: c.workspaceId, name: c.name },
      schemas: await listCustomFormSchemas({ workspaceId: c.workspaceId }),
    })),
  )

  return (
    <main
      className="min-h-screen p-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="lbl" style={{ color: 'var(--mute)' }}>
            § FORMS
          </div>
          <h1
            className="ts-22 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            Designer schemas
          </h1>
          <p className="ts-12 mt-1" style={{ color: 'var(--mute2)' }}>
            PM-defined form schemas saved per workspace. Pick a schema
            when creating a task with the “custom-designer” template.
          </p>
        </div>
        <Link
          href="/admin/forms/new"
          className="ts-12 mono px-3 py-1.5 rounded"
          style={{
            background: 'oklch(0.6 0.18 280)',
            color: 'white',
            border: '1px solid oklch(0.6 0.18 280 / 0.6)',
            textDecoration: 'none',
          }}
        >
          + New form
        </Link>
      </div>

      <div className="flex flex-col gap-6">
        {sections.map(({ workspace, schemas }) => (
          <section
            key={workspace.id}
            className="rounded p-4"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            <div
              className="lh-mono lh-caption mb-3"
              style={{ color: 'var(--mute)' }}
            >
              {workspace.name.toUpperCase()}
            </div>
            {schemas.length === 0 ? (
              <p
                className="ts-12"
                style={{ color: 'var(--mute2)' }}
              >
                No saved forms yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {schemas.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/admin/forms/${s.id}`}
                      className="ts-13 flex items-center justify-between px-3 py-2 rounded"
                      style={{
                        background: 'var(--panel2)',
                        border: '1px solid var(--line)',
                        color: 'var(--text)',
                        textDecoration: 'none',
                      }}
                    >
                      <span>{s.label}</span>
                      <span
                        className="ts-11 mono"
                        style={{ color: 'var(--mute2)' }}
                      >
                        v{s.version} · {s.createdAt.toISOString().slice(0, 10)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  )
}
