'use client'

import type { ReactNode } from 'react'
import { useState, useTransition } from 'react'
import {
  Archive,
  Braces,
  Download,
  FileJson,
  FileSpreadsheet,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react'
import { freezeDatasetVersion } from '@/lib/actions/dataset-versions'
import type { DatasetVersionSummary } from '@/lib/queries/dataset-versions'
import { getErrorMessage } from '@/lib/errors/client-utils'

const RAW_TABLE_MAPPING = encodeURIComponent(
  JSON.stringify([
    { source: 'annotationId', target: 'annotation_id' },
    { source: 'topicId', target: 'topic_id' },
    { source: 'taskId', target: 'task_id' },
    { source: 'userId', target: 'user_id' },
    { source: 'templateMode', target: 'template_mode' },
    { source: 'submittedAt', target: 'submitted_at' },
    { source: 'payload', target: 'payload_json', transform: 'json_stringify' },
    { source: 'itemData', target: 'item_json', transform: 'json_stringify' },
  ]),
)

type ExportEncoding = 'json' | 'jsonl' | 'csv' | 'excel'
type ExportShape = 'raw' | 'teaching'

const EXPORT_FIELDS = [
  {
    source: 'annotationId',
    target: 'annotation_id',
    label: 'Annotation ID',
    group: 'audit',
  },
  { source: 'topicId', target: 'topic_id', label: 'Topic ID', group: 'audit' },
  { source: 'taskId', target: 'task_id', label: 'Task ID', group: 'audit' },
  { source: 'userId', target: 'user_id', label: 'Labeler ID', group: 'audit' },
  {
    source: 'submittedAt',
    target: 'submitted_at',
    label: 'Submitted at',
    group: 'audit',
  },
  {
    source: 'approvedAtSnapshot',
    target: 'approved_at',
    label: 'Approved at',
    group: 'audit',
  },
  {
    source: 'templateMode',
    target: 'template_mode',
    label: 'Template mode',
    group: 'audit',
  },
  {
    source: 'payload',
    target: 'payload_json',
    label: 'Annotation payload',
    group: 'data',
    transform: 'json_stringify',
  },
  {
    source: 'itemData',
    target: 'item_json',
    label: 'Source item',
    group: 'data',
    transform: 'json_stringify',
  },
  {
    source: 'claudeProposal',
    target: 'ai_proposal_json',
    label: 'AI proposal',
    group: 'data',
    transform: 'json_stringify',
  },
  {
    source: 'deltaSummary',
    target: 'delta_summary',
    label: 'Delta summary',
    group: 'data',
  },
  {
    source: 'reasoningText',
    target: 'reasoning_text',
    label: 'Reasoning text',
    group: 'data',
  },
] as const

type ExportField = (typeof EXPORT_FIELDS)[number]
type FieldKey = ExportField['source']

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
          getErrorMessage(e, 'Freeze failed.'),
        )
      }
    })
  }

  return (
    <section
      className="rounded-lg p-5 mt-6"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="lbl mb-1">DATASET VERSIONS</div>
          <h3 className="ts-16" style={{ color: 'var(--hi)' }}>
            Frozen snapshots
          </h3>
          <p className="ts-12 mt-1 max-w-[720px]" style={{ color: 'var(--mute)' }}>
            Capture approved annotations into immutable versions, then
            export the same snapshot as raw data or teaching-ready rows.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MiniStat label="Versions" value={String(initialVersions.length)} />
          <MiniStat
            label="Items"
            value={String(initialVersions.reduce((sum, v) => sum + v.itemCount, 0))}
          />
        </div>
      </div>

      {isAdmin && (
        <div
          className="rounded-md p-4 mb-4"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--line)',
          }}
        >
          <div className="mb-3 flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center rounded"
              style={{
                width: 28,
                height: 28,
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                color: 'var(--mute)',
              }}
            >
              <Archive size={14} />
            </span>
            <div>
              <div className="lbl" style={{ color: 'var(--mute)' }}>
                FREEZE NEW VERSION
              </div>
              <div className="ts-12" style={{ color: 'var(--mute2)' }}>
                Snapshot only approved annotations.
              </div>
            </div>
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
                minHeight: 36,
                background: pending ? 'var(--panel2)' : 'var(--accent)',
                color: pending ? 'var(--mute)' : 'white',
                border: '1px solid var(--accent)',
                cursor: pending ? 'wait' : 'pointer',
              }}
            >
              {pending ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
              {pending ? 'Freezing' : 'Freeze'}
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

      {initialVersions.length === 0 ? (
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
            ? ' Approve some annotations, then create a snapshot.'
            : ' Workspace admins can create snapshots from here.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {initialVersions.map((v) => (
            <li
              key={v.id}
              className="rounded-md p-3 flex flex-col gap-3"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className="mono ts-13"
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
                  className="ts-12 mono mt-1"
                  style={{ color: 'var(--mute2)' }}
                >
                  frozen {new Date(v.frozenAt).toLocaleString()} ·{' '}
                  by{' '}
                  {v.frozenByDisplayName ??
                    v.frozenByEmail?.split('@')[0] ??
                    'system'}
                </div>
              </div>
              <div
                className="flex flex-wrap items-center gap-2 pt-3"
                style={{ borderTop: '1px solid var(--line)' }}
              >
                <ExportLink
                  href={exportHref(v.id, 'raw', 'jsonl')}
                  label="Raw JSONL"
                  icon={<FileJson size={14} />}
                />
                <ExportLink
                  href={exportHref(v.id, 'raw', 'csv', RAW_TABLE_MAPPING)}
                  label="Raw CSV"
                  icon={<FileSpreadsheet size={14} />}
                />
                <ExportLink
                  href={exportHref(v.id, 'raw', 'excel', RAW_TABLE_MAPPING)}
                  label="Raw Excel"
                  icon={<FileSpreadsheet size={14} />}
                />
                <ExportLink
                  href={exportHref(v.id, 'teaching', 'jsonl')}
                  label="Teaching JSONL"
                  icon={<Braces size={14} />}
                  accent
                />
              </div>
              <ExportBuilder versionId={v.id} />
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

function exportHref(
  versionId: string,
  format: ExportShape,
  encoding: ExportEncoding,
  mapping?: string,
): string {
  const base = `/api/export/dataset?versionId=${versionId}&format=${format}&encoding=${encoding}`
  return mapping ? `${base}&mapping=${mapping}` : base
}

function ExportBuilder({ versionId }: { versionId: string }) {
  const [open, setOpen] = useState(false)
  const [shape, setShape] = useState<ExportShape>('raw')
  const [encoding, setEncoding] = useState<ExportEncoding>('csv')
  const [includeAudit, setIncludeAudit] = useState(true)
  const [selected, setSelected] = useState<Set<FieldKey>>(
    () =>
      new Set([
        'annotationId',
        'topicId',
        'taskId',
        'submittedAt',
        'approvedAtSnapshot',
        'payload',
        'itemData',
      ]),
  )
  const [targets, setTargets] = useState<Record<FieldKey, string>>(() =>
    Object.fromEntries(
      EXPORT_FIELDS.map((field) => [field.source, field.target]),
    ) as Record<FieldKey, string>,
  )

  const fields =
    shape === 'teaching'
      ? EXPORT_FIELDS.filter((field) =>
          [
            'annotationId',
            'topicId',
            'submittedAt',
            'approvedAtSnapshot',
            'itemData',
            'claudeProposal',
            'deltaSummary',
          ].includes(field.source),
        )
      : EXPORT_FIELDS

  const effectiveSelected = fields.filter((field) => {
    if (!includeAudit && field.group === 'audit') return false
    return selected.has(field.source)
  })
  const mapping = effectiveSelected.map((field) => ({
    source: field.source,
    target: targets[field.source] || field.target,
    ...('transform' in field ? { transform: field.transform } : {}),
  }))
  const href = exportHref(
    versionId,
    shape,
    encoding,
    encodeURIComponent(JSON.stringify(mapping)),
  )

  function toggleField(source: FieldKey) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

  return (
    <div
      className="rounded p-3"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ts-12 mono flex w-full items-center justify-between gap-3"
        style={{
          color: 'var(--text)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal size={14} />
          Custom export mapping
        </span>
        <span style={{ color: 'var(--mute2)' }}>
          {open ? 'Hide' : 'Configure'}
        </span>
      </button>

      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid gap-2 md:grid-cols-3">
            <LabeledSelect
              label="Shape"
              value={shape}
              onChange={(value) => setShape(value as ExportShape)}
              options={[
                ['raw', 'Raw rows'],
                ['teaching', 'Teaching rows'],
              ]}
            />
            <LabeledSelect
              label="Encoding"
              value={encoding}
              onChange={(value) => setEncoding(value as ExportEncoding)}
              options={[
                ['csv', 'CSV'],
                ['excel', 'Excel'],
                ['jsonl', 'JSONL'],
                ['json', 'JSON'],
              ]}
            />
            <label
              className="ts-12 mono flex items-end gap-2 rounded px-3 py-2"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
                minHeight: 56,
              }}
            >
              <input
                type="checkbox"
                checked={includeAudit}
                onChange={(e) => setIncludeAudit(e.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              Include audit fields
            </label>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {fields.map((field) => {
              const disabled = !includeAudit && field.group === 'audit'
              const checked = !disabled && selected.has(field.source)
              return (
                <div
                  key={field.source}
                  className="rounded p-2"
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    opacity: disabled ? 0.55 : 1,
                  }}
                >
                  <label className="flex items-center gap-2 ts-12">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleField(field.source)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                      {field.label}
                    </span>
                    {field.group === 'audit' ? (
                      <span
                        className="ts-11 mono ml-auto"
                        style={{ color: 'var(--mute2)' }}
                      >
                        audit
                      </span>
                    ) : null}
                  </label>
                  <input
                    value={targets[field.source]}
                    disabled={!checked}
                    onChange={(e) =>
                      setTargets((prev) => ({
                        ...prev,
                        [field.source]: e.target.value,
                      }))
                    }
                    className="ts-12 mono mt-2 w-full rounded px-2 py-1"
                    style={{
                      background: 'var(--panel)',
                      border: '1px solid var(--line)',
                      color: 'var(--text)',
                    }}
                  />
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
              {mapping.length} mapped field{mapping.length === 1 ? '' : 's'}
            </div>
            <a
              href={href}
              className="ts-12 mono inline-flex items-center gap-2 rounded px-3"
              style={{
                minHeight: 36,
                background: 'var(--accent)',
                color: 'white',
                border: '1px solid var(--accent)',
                textDecoration: 'none',
                pointerEvents: mapping.length === 0 ? 'none' : 'auto',
                opacity: mapping.length === 0 ? 0.55 : 1,
              }}
            >
              <Download size={14} />
              Export mapped file
            </a>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<[string, string]>
}) {
  return (
    <label className="block">
      <span className="ts-11 mono mb-1 block" style={{ color: 'var(--mute)' }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="ts-12 mono w-full rounded px-3"
        style={{
          minHeight: 36,
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          color: 'var(--text)',
        }}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded ts-12 mono"
      style={{
        minHeight: 32,
        padding: '0 10px',
        color: 'var(--text)',
        background: 'var(--bg)',
        border: '1px solid var(--line)',
      }}
    >
      <span style={{ color: 'var(--mute2)' }}>{label}</span>
      <span>{value}</span>
    </span>
  )
}

function ExportLink({
  href,
  label,
  icon,
  accent,
}: {
  href: string
  label: string
  icon: ReactNode
  accent?: boolean
}) {
  return (
    <a
      href={href}
      className="ts-12 mono px-3 rounded inline-flex items-center gap-2"
      style={{
        minHeight: 36,
        background: accent ? 'var(--accent-soft)' : 'var(--panel2)',
        color: accent ? 'var(--accent)' : 'var(--text)',
        border: `1px solid ${accent ? 'var(--accent-line)' : 'var(--line)'}`,
        textDecoration: 'none',
      }}
    >
      <Download size={14} />
      {icon}
      {label}
    </a>
  )
}
