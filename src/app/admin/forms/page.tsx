import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  FilePlus2,
  FileText,
  Layers,
  PenLine,
  Plus,
  Sparkles,
} from 'lucide-react'
import { optionalUser } from '@/lib/auth/guards'
import { getAdminDashboardData } from '@/lib/queries/admin-dashboard'
import {
  listCustomFormSchemas,
  setWorkspaceTemplateFlag,
} from '@/lib/form-designer/storage'
import { StatCard } from '@/components/ui/stat-card'

export const metadata: Metadata = {
  title: 'Forms · Designer — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /admin/forms — Designer schema library.
 *
 * Index of saved Designer schemas across every workspace this admin
 * owns. Schemas are versioned and can be promoted into workspace
 * templates for future form creation.
 */
export default async function FormsListPage() {
  const me = await optionalUser()
  if (!me) redirect('/signin?next=/admin/forms')

  const dashboard = await getAdminDashboardData({ userId: me.id })
  if (dashboard.cards.length === 0) notFound()

  const sections = await Promise.all(
    dashboard.cards.map(async (c) => ({
      workspace: { id: c.workspaceId, name: c.name },
      schemas: await listCustomFormSchemas({ workspaceId: c.workspaceId }),
    })),
  )

  const totals = sections.reduce(
    (acc, section) => {
      acc.workspaces += 1
      acc.schemas += section.schemas.length
      acc.templates += section.schemas.filter((s) => s.isTemplate).length
      acc.fields += section.schemas.reduce((sum, s) => sum + s.fieldCount, 0)
      return acc
    },
    { workspaces: 0, schemas: 0, templates: 0, fields: 0 },
  )

  return (
    <main
      className="min-h-screen px-4 py-6 sm:px-6 lg:px-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="lbl">DESIGNER LIBRARY</div>
            <h1
              className="ts-24 mt-2"
              style={{ color: 'var(--hi)', fontWeight: 560 }}
            >
              Form schemas
            </h1>
            <p className="ts-13 mt-1 max-w-[720px]" style={{ color: 'var(--mute)' }}>
              Manage versioned form schemas used by custom-designer tasks.
            </p>
          </div>
          <Link
            href="/admin/forms/new"
            className="lh-btn lh-btn-accent"
            style={{ textDecoration: 'none' }}
          >
            <Plus size={16} />
            New form
          </Link>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <StatCard label="Workspaces" value={String(totals.workspaces)} icon={<BookOpen size={17} />} />
          <StatCard label="Schemas" value={String(totals.schemas)} icon={<FileText size={17} />} />
          <StatCard label="Templates" value={String(totals.templates)} icon={<Sparkles size={17} />} tone="accent" />
          <StatCard label="Fields" value={String(totals.fields)} icon={<Layers size={17} />} />
        </section>

        <div className="flex flex-col gap-5">
          {sections.map(({ workspace, schemas }) => {
            const templateCount = schemas.filter((s) => s.isTemplate).length
            return (
              <section
                key={workspace.id}
                className="rounded p-4"
                style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--line)',
                }}
              >
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <div className="lbl">WORKSPACE</div>
                    <h2
                      className="ts-16 mt-1 truncate"
                      style={{ color: 'var(--hi)', fontWeight: 560 }}
                    >
                      {workspace.name}
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <MiniPill label="Schemas" value={String(schemas.length)} />
                    <MiniPill label="Templates" value={String(templateCount)} />
                  </div>
                </div>

                {schemas.length === 0 ? (
                  <EmptyWorkspace />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {schemas.map((schema) => (
                      <article
                        key={schema.id}
                        className="rounded p-4"
                        style={{
                          background: 'var(--bg)',
                          border: '1px solid var(--line)',
                          minHeight: 188,
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 gap-3">
                            <span
                              className="inline-flex items-center justify-center rounded"
                              style={{
                                width: 34,
                                height: 34,
                                background: schema.isTemplate
                                  ? 'var(--accent-soft)'
                                  : 'var(--panel2)',
                                border: `1px solid ${schema.isTemplate ? 'var(--accent-line)' : 'var(--line)'}`,
                                color: schema.isTemplate ? 'var(--accent)' : 'var(--mute)',
                                flex: '0 0 auto',
                              }}
                            >
                              {schema.isTemplate ? <Sparkles size={16} /> : <FileText size={16} />}
                            </span>
                            <div className="min-w-0">
                              <h3
                                className="ts-14 truncate"
                                style={{ color: 'var(--hi)', fontWeight: 560 }}
                                title={schema.label}
                              >
                                {schema.label}
                              </h3>
                              <div className="ts-12 mono mt-1" style={{ color: 'var(--mute2)' }}>
                                v{schema.version} / {schema.createdAt.toISOString().slice(0, 10)}
                              </div>
                            </div>
                          </div>
                          {schema.isTemplate ? (
                            <Badge tone="accent">
                              <CheckCircle2 size={13} />
                              Template
                            </Badge>
                          ) : null}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <MiniPill label="Fields" value={String(schema.fieldCount)} />
                          {schema.hasLlmTrigger ? (
                            <Badge tone="accent">
                              <Sparkles size={13} />
                              LLM assist
                            </Badge>
                          ) : null}
                        </div>

                        <div
                          className="mt-4 flex flex-wrap items-center gap-2 pt-3"
                          style={{ borderTop: '1px solid var(--line)' }}
                        >
                          <Link
                            href={`/admin/forms/${schema.id}`}
                            className="lh-btn lh-btn-ghost lh-btn-sm"
                            style={{ textDecoration: 'none' }}
                          >
                            <PenLine size={14} />
                            Edit
                            <ArrowRight size={13} />
                          </Link>
                          <ToggleTemplateForm
                            schemaId={schema.id}
                            workspaceId={workspace.id}
                            isTemplate={schema.isTemplate}
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </main>
  )
}

function EmptyWorkspace() {
  return (
    <div
      className="rounded p-8 text-center ts-13"
      style={{
        background: 'var(--bg)',
        border: '1px dashed var(--line2)',
        color: 'var(--mute2)',
      }}
    >
      <div
        className="mx-auto mb-3 inline-flex items-center justify-center rounded"
        style={{
          width: 40,
          height: 40,
          background: 'var(--panel2)',
          border: '1px solid var(--line)',
          color: 'var(--mute)',
        }}
      >
        <FilePlus2 size={18} />
      </div>
      <div>No saved forms yet.</div>
      <Link
        href="/admin/forms/new"
        className="lh-btn lh-btn-ghost mt-4"
        style={{ textDecoration: 'none' }}
      >
        <Plus size={15} />
        New form
      </Link>
    </div>
  )
}

function MiniPill({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded ts-12 mono"
      style={{
        minHeight: 30,
        padding: '0 9px',
        color: 'var(--text)',
        background: 'var(--panel2)',
        border: '1px solid var(--line)',
      }}
    >
      <span style={{ color: 'var(--mute2)' }}>{label}</span>
      <span>{value}</span>
    </span>
  )
}

function Badge({
  tone,
  children,
}: {
  tone: 'accent'
  children: ReactNode
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded ts-11 mono"
      style={{
        minHeight: 24,
        padding: '0 7px',
        color: tone === 'accent' ? 'var(--accent)' : 'var(--mute)',
        background: tone === 'accent' ? 'var(--accent-soft)' : 'var(--panel2)',
        border: `1px solid ${tone === 'accent' ? 'var(--accent-line)' : 'var(--line)'}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

/**
 * Per-row form that flips the workspace-template flag. Server
 * action runs requireWorkspaceAdmin inside `setWorkspaceTemplateFlag`.
 */
function ToggleTemplateForm({
  schemaId,
  workspaceId,
  isTemplate,
}: {
  schemaId: string
  workspaceId: string
  isTemplate: boolean
}) {
  async function action() {
    'use server'
    await setWorkspaceTemplateFlag({
      id: schemaId,
      workspaceId,
      isTemplate: !isTemplate,
    })
    revalidatePath('/admin/forms')
  }
  return (
    <form action={action}>
      <button
        type="submit"
        className="lh-btn lh-btn-ghost lh-btn-sm"
        style={{ cursor: 'pointer' }}
        title={
          isTemplate
            ? 'Remove from workspace templates'
            : 'Promote to workspace template'
        }
      >
        <BadgeCheck size={14} />
        {isTemplate ? 'Demote' : 'Use as template'}
      </button>
    </form>
  )
}
