'use client'

import { useState, useTransition } from 'react'
import { freezeDatasetVersion } from '@/lib/actions/dataset-versions'
import type { DatasetVersionSummary } from '@/lib/queries/dataset-versions'

/**
 * Dataset Versions card on /workspaces/[id]/settings (Phase-14).
 *
 * Admin-only surface. Two things:
 *   1. Freeze form — optional label + optional description.
 *   2. History list — each version exposes a Download button that
 *      hits /api/export/dataset?versionId=... (admin-only route).
 *
 * Server-rendered initial list; client refreshes on freeze success.
 */
export function DatasetVersionsCard({
  workspaceId,
  initialVersions,
  isAdmin,
}: {
  workspaceId: string
  initialVersions: DatasetVersionSummary[]
  isAdmin: boolean
}) {
  const [versions, setVersions] = useState(initialVersions)
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [lastFrozen, setLastFrozen] = useState<string | null>(null)

  function freeze() {
    setError(null)
    setLastFrozen(null)
    startTransition(async () => {
      try {
        const r = await freezeDatasetVersion({
          workspaceId,
          label: label.trim() || undefined,
          description: description.trim() || undefined,
        })
        setLastFrozen(`${r.label} · ${r.itemCount} items`)
        setLabel('')
        setDescription('')
        // Soft refresh: prepend the new version to the list (we don't
        // know frozenAt or frozenBy from the action shape, so do a
        // hard reload to pull the canonical row).
        window.location.reload()
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Freeze failed.',
        )
      }
    })
    void setVersions
  }

  return (
    <section
      className="rounded-lg p-5 mt-6"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="mb-4">
        <div className="lbl mb-1">§ DATASET VERSIONS</div>
        <h3 className="ts-16" style={{ color: 'var(--hi)' }}>
          Frozen snapshots
        </h3>
        <p className="ts-12 mt-1" style={{ color: 'var(--mute)' }}>
          Capture the current set of approved annotations into a
          labeled version. Downstream training pipelines can re-pull
          the exact state of "v3" months later — even after restores,
          revisions, or soft-deletes shift the live table.
        </p>
      </div>

      {isAdmin && (
        <div
          className="rounded-md p-4 mb-4"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--line)',
          }}
        >
          <div className="lbl mb-2" style={{ color: 'var(--mute)' }}>
            § FREEZE NEW VERSION
          </div>
          <div className="flex gap-2 flex-wrap items-start">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="label (auto = v{n})"
              className="ts-12 mono"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '6px 10px',
                color: 'var(--text)',
                minWidth: 140,
              }}
              maxLength={60}
              disabled={pending}
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="optional description"
              className="ts-12 flex-1 min-w-[200px]"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '6px 10px',
                color: 'var(--text)',
              }}
              maxLength={2000}
              disabled={pending}
            />
            <button
              type="button"
              onClick={freeze}
              disabled={pending}
              className="ts-12 mono px-3 py-1.5 rounded inline-flex items-center gap-2"
              style={{
                background: pending ? 'var(--panel2)' : 'var(--accent)',
                color: pending ? 'var(--mute)' : 'white',
                border: '1px solid var(--accent)',
                cursor: pending ? 'wait' : 'pointer',
              }}
            >
              {pending ? 'freezing…' : '▶ freeze'}
            </button>
          </div>
          {error && (
            <div
              className="ts-12 mono mt-3 px-2 py-1 rounded"
              style={{
                background: 'var(--danger-soft)',
                color: 'var(--danger)',
                border: '1px solid oklch(0.55 0.2 25 / 0.35)',
              }}
            >
              {error}
            </div>
          )}
          {lastFrozen && (
            <div
              className="ts-12 mono mt-3"
              style={{ color: 'var(--success)' }}
            >
              ✓ frozen {lastFrozen}
            </div>
          )}
        </div>
      )}

      {versions.length === 0 ? (
        <div
          className="rounded-md px-4 py-6 text-center ts-13"
          style={{
            background: 'var(--bg)',
            border: '1px dashed var(--line)',
            color: 'var(--mute2)',
          }}
        >
          No versions frozen yet.
          {isAdmin
            ? ' Approve some annotations, then click ▶ freeze.'
            : ' Workspace admins can create snapshots from here.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {versions.map((v) => (
            <li
              key={v.id}
              className="rounded-md p-3 flex items-center justify-between gap-3 flex-wrap"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className="mono ts-14"
                    style={{ color: 'var(--accent)', fontWeight: 600 }}
                  >
                    {v.label}
                  </span>
                  <span
                    className="ts-12 mono"
                    style={{ color: 'var(--mute)' }}
                  >
                    {v.itemCount} item{v.itemCount === 1 ? '' : 's'} ·{' '}
                    {formatBytes(v.byteSize)}
                  </span>
                </div>
                {v.description && (
                  <div
                    className="ts-12 mt-1"
                    style={{ color: 'var(--text)' }}
                  >
                    {v.description}
                  </div>
                )}
                <div
                  className="ts-11 mono mt-1"
                  style={{ color: 'var(--mute2)' }}
                >
                  frozen {new Date(v.frozenAt).toLocaleString()} ·{' '}
                  by{' '}
                  {v.frozenByDisplayName ??
                    v.frozenByEmail?.split('@')[0] ??
                    'system'}
                </div>
              </div>
              <a
                href={`/api/export/dataset?versionId=${v.id}`}
                className="ts-12 mono px-3 py-1.5 rounded shrink-0"
                style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent-line)',
                  textDecoration: 'none',
                }}
                download={`labelhub-${v.label}.jsonl`}
              >
                ⬇ download .jsonl
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
