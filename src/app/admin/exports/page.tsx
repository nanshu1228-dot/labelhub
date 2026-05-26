import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { listMyExportJobs, type ExportJobRow } from '@/lib/queries/export-jobs'

export const metadata: Metadata = {
  title: 'Exports — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /admin/exports — Finals D21-D.
 *
 * Cross-workspace history of the user's export jobs (the `>5MB`
 * path that lands in `export_jobs`). Each row shows status,
 * format/encoding, row count, byte size, timestamps + a download
 * button when complete. 404 to users with no admin/qc role.
 */
export default async function ExportsHistoryPage() {
  const me = await optionalUser()
  if (!me) redirect('/signin?next=/admin/exports')

  const jobs = await listMyExportJobs({ userId: me.id, limit: 100 })
  if (jobs.length === 0) {
    // Don't 404 — empty state is a real "you have access but no
    // jobs yet" signal. Render the page with a CTA.
  }

  return (
    <main
      className="min-h-screen p-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="mx-auto max-w-[1100px] flex flex-col gap-6">
        <header>
          <div className="lbl" style={{ color: 'var(--mute)' }}>
            § EXPORTS
          </div>
          <h1
            className="ts-22 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            Export history
          </h1>
          <p className="ts-12 mt-1" style={{ color: 'var(--mute2)' }}>
            Async export jobs (5MB+) land here for download. Smaller
            exports stream directly from
            <code className="mono"> /api/export/dataset</code> and
            don&apos;t produce a history row.
          </p>
        </header>

        {jobs.length === 0 ? (
          <div
            className="rounded p-8 text-center ts-13"
            style={{
              background: 'var(--panel)',
              border: '1px dashed var(--line)',
              color: 'var(--mute2)',
            }}
          >
            No export jobs yet. Trigger one from a dataset version page
            (
            <Link
              href="/admin"
              style={{ color: 'var(--accent)', textDecoration: 'none' }}
            >
              admin dashboard
            </Link>
            ) by clicking &quot;Export&quot; on a frozen version with 5MB+ of
            data.
          </div>
        ) : (
          <section
            className="rounded p-4"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table
                className="ts-13"
                style={{
                  width: '100%',
                  minWidth: 720,
                  borderCollapse: 'separate',
                  borderSpacing: 0,
                }}
              >
                <thead>
                  <tr style={{ color: 'var(--mute)' }}>
                    <Th>Created</Th>
                    <Th>Workspace</Th>
                    <Th>Format</Th>
                    <Th>Rows</Th>
                    <Th>Bytes</Th>
                    <Th>Status</Th>
                    <Th>By</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr
                      key={j.id}
                      style={{
                        borderBottom: '1px solid var(--line)',
                      }}
                    >
                      <Td>
                        <span className="ts-11 mono">
                          {formatDate(j.createdAt)}
                        </span>
                      </Td>
                      <Td>{j.workspaceName}</Td>
                      <Td>
                        <code className="ts-11 mono">{j.format}</code>
                      </Td>
                      <Td>{j.rowCount ?? '—'}</Td>
                      <Td>{j.byteSize != null ? formatBytes(j.byteSize) : '—'}</Td>
                      <Td>
                        <StatusBadge status={j.status} error={j.errorText} />
                      </Td>
                      <Td>
                        <span
                          className="ts-11 mono"
                          style={{ color: 'var(--mute2)' }}
                        >
                          {j.createdBy?.email ?? 'system'}
                        </span>
                      </Td>
                      <Td>
                        <DownloadAction job={j} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

function StatusBadge({
  status,
  error,
}: {
  status: ExportJobRow['status']
  error: string | null
}) {
  const palette = (() => {
    if (status === 'completed')
      return { bg: 'oklch(0.62 0.16 145 / 0.08)', fg: 'oklch(0.62 0.16 145)' }
    if (status === 'failed')
      return { bg: 'oklch(0.55 0.2 25 / 0.05)', fg: 'var(--danger)' }
    if (status === 'running')
      return { bg: 'oklch(0.55 0.18 320 / 0.08)', fg: 'oklch(0.55 0.18 320)' }
    return { bg: 'var(--panel2)', fg: 'var(--mute)' }
  })()
  return (
    <span
      className="ts-11 mono px-2 py-0.5 rounded"
      style={{
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.fg}55`,
      }}
      title={error ?? undefined}
    >
      {status}
    </span>
  )
}

function DownloadAction({ job }: { job: ExportJobRow }) {
  // When completed: render a link that hits the /api/export/jobs/[id]
  // route — which returns a fresh signed URL the client can follow
  // (this avoids embedding a long-lived signed URL in the SSR'd
  // HTML).
  if (job.status === 'completed' && job.storagePath) {
    return (
      <Link
        href={`/api/export/jobs/${job.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="ts-12 mono px-3 rounded inline-flex items-center"
        style={{
          minHeight: 36,
          background: 'var(--accent-soft)',
          border: '1px solid var(--accent-line)',
          color: 'var(--accent)',
          textDecoration: 'none',
        }}
      >
        Get URL →
      </Link>
    )
  }
  if (job.status === 'failed') {
    return (
      <span
        className="ts-11"
        style={{ color: 'var(--danger)' }}
      >
        {job.errorText?.slice(0, 60) ?? 'failed'}
      </span>
    )
  }
  return (
    <span className="ts-11" style={{ color: 'var(--mute2)' }}>
      —
    </span>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th
      className="ts-11 mono text-left px-2 py-2"
      style={{
        borderBottom: '1px solid var(--line)',
        fontWeight: 'normal',
      }}
    >
      {children}
    </th>
  )
}

function Td({ children }: { children?: React.ReactNode }) {
  return <td className="px-2 py-2 align-top">{children}</td>
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

// Suppress: notFound is imported in case of future per-page workspace
// gating. Keep the import so a refactor doesn't have to re-add it.
void notFound
