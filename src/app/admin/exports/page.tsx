import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  CheckCircle2,
  DatabaseZap,
  FileArchive,
  FileJson,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react'
import { optionalUser } from '@/lib/auth/guards'
import { listMyExportJobs, type ExportJobRow } from '@/lib/queries/export-jobs'
import { ExportJobLiveCells } from '@/components/export/export-job-live-cells'
import { StatCard } from '@/components/ui/stat-card'

export const metadata: Metadata = {
  title: 'Exports — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /admin/exports — Finals D21-D.
 *
 * Cross-workspace history of the user's export jobs (the `>5MB`
 * async path that lands in `export_jobs`). Smaller exports stream
 * directly from `/api/export/dataset` and are surfaced from each
 * workspace's dataset version card.
 */
export default async function ExportsHistoryPage() {
  const me = await optionalUser()
  if (!me) redirect('/signin?next=/admin/exports')

  const jobs = await listMyExportJobs({ userId: me.id, limit: 100 })
  const stats = summarizeJobs(jobs)

  return (
    <main
      className="min-h-screen px-4 py-6 sm:px-6 lg:px-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="lbl">DELIVERY CONSOLE</div>
            <h1
              className="ts-24 mt-2"
              style={{ color: 'var(--hi)', fontWeight: 560 }}
            >
              Export history
            </h1>
            <p className="ts-13 mt-1 max-w-[720px]" style={{ color: 'var(--mute)' }}>
              Track large dataset exports, retrieve short-lived download URLs,
              and confirm the formats available for frozen snapshots.
            </p>
          </div>
          <Link
            href="/admin"
            className="lh-btn lh-btn-ghost"
            style={{ textDecoration: 'none' }}
          >
            <DatabaseZap size={16} />
            Admin dashboard
          </Link>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <StatCard
            label="Jobs"
            value={String(jobs.length)}
            icon={<FileArchive size={17} />}
          />
          <StatCard
            label="Completed"
            value={String(stats.completed)}
            icon={<CheckCircle2 size={17} />}
            tone="success"
          />
          <StatCard
            label="Running"
            value={String(stats.active)}
            icon={<Loader2 size={17} />}
            tone="accent"
          />
          <StatCard
            label="Rows Exported"
            value={formatNumber(stats.rows)}
            icon={<DatabaseZap size={17} />}
          />
        </section>

        <section className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr]">
          <FormatCard
            title="JSONL"
            detail="Streaming training pipelines and append-friendly archives."
            icon={<FileJson size={17} />}
          />
          <FormatCard
            title="JSON"
            detail="Single array document for small reproducible snapshots."
            icon={<FileJson size={17} />}
          />
          <FormatCard
            title="CSV"
            detail="Mapped tabular export with formula-injection defense."
            icon={<FileSpreadsheet size={17} />}
          />
          <FormatCard
            title="Excel"
            detail="Reviewer-friendly workbook export for handoff."
            icon={<FileSpreadsheet size={17} />}
          />
        </section>

        <section
          className="rounded p-4"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="lbl">ASYNC JOB HISTORY</div>
              <h2
                className="ts-16 mt-1"
                style={{ color: 'var(--hi)', fontWeight: 560 }}
              >
                Large export jobs
              </h2>
            </div>
            <div className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
              {formatBytes(stats.bytes)} generated
            </div>
          </div>

          {jobs.length === 0 ? (
            <EmptyState />
          ) : (
            <div
              style={{
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <table
                className="ts-13"
                style={{
                  width: '100%',
                  minWidth: 860,
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
                    <Th>Size</Th>
                    <Th>Status</Th>
                    <Th>Download</Th>
                    <Th>By</Th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      style={{ borderBottom: '1px solid var(--line)' }}
                    >
                      <Td>
                        <span className="ts-11 mono">{formatDate(job.createdAt)}</span>
                      </Td>
                      <Td>
                        <div className="flex flex-col">
                          <span style={{ color: 'var(--hi)' }}>{job.workspaceName}</span>
                          <span className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
                            {job.id.slice(0, 8)}
                          </span>
                        </div>
                      </Td>
                      <Td>
                        <code className="ts-11 mono">{job.format}</code>
                      </Td>
                      <Td>{job.rowCount != null ? formatNumber(job.rowCount) : '—'}</Td>
                      <Td>{job.byteSize != null ? formatBytes(job.byteSize) : '—'}</Td>
                      <ExportJobLiveCells job={toLiveJob(job)} />
                      <Td>
                        <span className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
                          {job.createdBy?.email ?? 'system'}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function EmptyState() {
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
        <FileArchive size={18} />
      </div>
      <div>No export jobs yet.</div>
      <div className="mt-1">
        Create a frozen dataset version from a workspace settings page,
        then export a large snapshot to populate this history.
      </div>
    </div>
  )
}

function FormatCard({
  title,
  detail,
  icon,
}: {
  title: string
  detail: string
  icon: ReactNode
}) {
  return (
    <div
      className="rounded p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        minHeight: 118,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center rounded"
          style={{
            width: 30,
            height: 30,
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent-line)',
            color: 'var(--accent)',
          }}
        >
          {icon}
        </span>
        <h2 className="ts-14" style={{ color: 'var(--hi)', fontWeight: 560 }}>
          {title}
        </h2>
      </div>
      <p className="ts-12 mt-3" style={{ color: 'var(--mute)' }}>
        {detail}
      </p>
    </div>
  )
}

function Th({ children }: { children?: ReactNode }) {
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

function Td({ children }: { children?: ReactNode }) {
  return <td className="px-2 py-2 align-top">{children}</td>
}

function summarizeJobs(jobs: ExportJobRow[]) {
  return jobs.reduce(
    (acc, job) => {
      if (job.status === 'completed') acc.completed += 1
      if (job.status === 'running' || job.status === 'pending') acc.active += 1
      if (job.status === 'failed') acc.failed += 1
      acc.rows += job.rowCount ?? 0
      acc.bytes += job.byteSize ?? 0
      return acc
    },
    { completed: 0, active: 0, failed: 0, rows: 0, bytes: 0 },
  )
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

function toLiveJob(job: ExportJobRow) {
  return {
    id: job.id,
    status: job.status,
    byteSize: job.byteSize,
    rowCount: job.rowCount,
    storagePath: job.storagePath,
    errorText: job.errorText,
  }
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
