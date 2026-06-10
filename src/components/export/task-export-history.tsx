import { CheckCircle2, FileDown } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import type { TaskExportHistoryRow } from '@/lib/queries/export-jobs'

/**
 * Recent exports for a single task — spec §4.6 "下载历史列表".
 *
 * Compact, server-renderable list of the task's last few annotation
 * pulls (format / status / rows / size / time). These exports stream
 * synchronously, so each row is already complete by the time it's
 * recorded — there's no async job to poll and no stored artifact to
 * re-download, so we render a static "completed" badge rather than the
 * live-cell poller used by the large dataset-version path on
 * `/admin/exports`. To pull a fresh file, owners use the export builder
 * above (the EmptyState CTA points there).
 */
export function TaskExportHistory({
  jobs,
}: {
  jobs: TaskExportHistoryRow[]
}) {
  if (jobs.length === 0) {
    return (
      <EmptyState
        scale="inline"
        label="DOWNLOAD HISTORY"
        title="No exports yet"
        description="Build one above and your recent downloads will show up here."
      />
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {jobs.map((job) => (
        <li
          key={job.id}
          className="flex items-center justify-between gap-3 rounded px-3 py-2"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--line)',
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex shrink-0 items-center justify-center rounded"
              style={{
                width: 28,
                height: 28,
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-line)',
                color: 'var(--accent)',
              }}
            >
              <FileDown size={14} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <code className="ts-12 mono" style={{ color: 'var(--text)' }}>
                  {job.format.toUpperCase()}
                </code>
                <span
                  className="ts-11 mono inline-flex items-center gap-1 rounded px-1.5"
                  style={{
                    minHeight: 20,
                    background: 'var(--success-soft)',
                    color: 'var(--success)',
                    border: '1px solid oklch(0.65 0.13 150 / 0.38)',
                  }}
                >
                  <CheckCircle2 size={11} />
                  completed
                </span>
              </div>
              <div className="ts-11 mono mt-0.5" style={{ color: 'var(--mute2)' }}>
                {job.rowCount != null ? `${formatNumber(job.rowCount)} rows` : '—'}
                {' · '}
                {job.byteSize != null ? formatBytes(job.byteSize) : '—'}
              </div>
            </div>
          </div>
          <span
            className="ts-11 mono shrink-0"
            style={{ color: 'var(--mute2)' }}
          >
            {formatDate(job.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
