'use client'

/**
 * Import wizard — presentational subcomponents.
 *
 * Extracted verbatim from `import-wizard.tsx` (behavior-preserving
 * relocation). Every component here is prop-only: it receives all its
 * data through props and owns no wizard state, effects, or handlers.
 * The wizard shell keeps all useState/useTransition/useMemo wiring and
 * simply renders these.
 */

import { useMemo } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  FileText,
} from 'lucide-react'
import type { ImportFormat, ParsedRow } from '@/lib/import/parsers'
import {
  FORMAT_ICONS,
  FORMAT_LABELS,
  deriveColumns,
  renderCell,
} from './import-wizard-helpers'

export function WorkflowRail({
  active,
}: {
  active: 'file' | 'preview' | 'distribution' | 'submit'
}) {
  const steps = [
    { id: 'file', label: 'Pick file', body: 'Detect format and file size' },
    { id: 'preview', label: 'Preview', body: 'Check columns and parse errors' },
    { id: 'distribution', label: 'Distribute', body: 'Assign rows or open queue' },
    { id: 'submit', label: 'Commit', body: 'Chunked server import' },
  ] as const
  const activeIndex = steps.findIndex((s) => s.id === active)
  return (
    <SidePanel label="IMPORT FLOW" title="Checklist" icon={<CheckCircle2 size={16} />}>
      <div className="grid gap-3">
        {steps.map((step, index) => {
          const done = index < activeIndex
          const isActive = step.id === active
          return (
            <div key={step.id} className="flex gap-3">
              <span
                className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded"
                style={{
                  width: 24,
                  height: 24,
                  color: done || isActive ? 'var(--accent)' : 'var(--mute2)',
                  background:
                    done || isActive ? 'var(--accent-soft)' : 'var(--panel2)',
                  border: `1px solid ${done || isActive ? 'var(--accent-line)' : 'var(--line)'}`,
                }}
              >
                {done ? <CheckCircle2 size={14} /> : <CircleDot size={13} />}
              </span>
              <div>
                <div className="ts-13" style={{ color: 'var(--text)', fontWeight: 600 }}>
                  {step.label}
                </div>
                <div className="ts-12 mt-0.5" style={{ color: 'var(--mute2)', lineHeight: 1.45 }}>
                  {step.body}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </SidePanel>
  )
}

export function SupportedFormats({ selected }: { selected: ImportFormat | null }) {
  return (
    <SidePanel label="FORMAT SUPPORT" title="Accepted files" icon={<FileText size={16} />}>
      <div className="grid gap-2">
        {(Object.keys(FORMAT_LABELS) as ImportFormat[]).map((format) => {
          const Icon = FORMAT_ICONS[format]
          const active = selected === format
          return (
            <div
              key={format}
              className="ts-12 mono flex items-center gap-2 rounded px-3"
              style={{
                minHeight: 38,
                color: active ? 'var(--accent)' : 'var(--text)',
                background: active ? 'var(--accent-soft)' : 'var(--bg)',
                border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
              }}
            >
              <Icon size={14} />
              {FORMAT_LABELS[format]}
            </div>
          )
        })}
      </div>
    </SidePanel>
  )
}

export function ImportRules() {
  return (
    <SidePanel label="VALIDATION" title="Import contract" icon={<AlertTriangle size={16} />}>
      <div className="grid gap-3 ts-12" style={{ color: 'var(--mute2)', lineHeight: 1.5 }}>
        <div>Each row must match the task template item schema.</div>
        <div>Parser errors are skipped. Template validation failures are reported after commit.</div>
        <div>Files are capped at 5,000 parsed rows per browser session.</div>
      </div>
    </SidePanel>
  )
}

export function SectionTitle({
  label,
  title,
  body,
  action,
}: {
  label: string
  title: string
  body?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="lbl">{label}</div>
        <h2 className="ts-16 mt-1" style={{ color: 'var(--hi)', fontWeight: 560 }}>
          {title}
        </h2>
        {body ? (
          <p className="ts-12 mt-1 max-w-[680px]" style={{ color: 'var(--mute2)' }}>
            {body}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function SidePanel({
  label,
  title,
  icon,
  children,
}: {
  label: string
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      className="rounded p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="lbl">{label}</div>
          <h2 className="ts-16 mt-1" style={{ color: 'var(--hi)', fontWeight: 560 }}>
            {title}
          </h2>
        </div>
        <span style={{ color: 'var(--mute)' }}>{icon}</span>
      </div>
      {children}
    </section>
  )
}

export function Metric({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string
  value: string
  icon: React.ReactNode
  tone?: 'neutral' | 'success' | 'warning'
}) {
  const color =
    tone === 'success'
      ? 'oklch(0.62 0.16 145)'
      : tone === 'warning'
        ? 'var(--warn)'
        : 'var(--mute)'
  return (
    <div
      className="rounded p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        minHeight: 104,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="lh-mono lh-caption" style={{ color: 'var(--mute2)' }}>
          {label}
        </div>
        <span style={{ color }}>{icon}</span>
      </div>
      <div
        className="ts-24 mt-3 truncate"
        style={{ color: 'var(--hi)', fontWeight: 560 }}
      >
        {value}
      </div>
    </div>
  )
}

export function Message({
  tone,
  icon,
  children,
}: {
  tone: 'success' | 'danger' | 'neutral'
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const palette =
    tone === 'success'
      ? {
          fg: 'oklch(0.62 0.16 145)',
          bg: 'oklch(0.62 0.16 145 / 0.08)',
          border: 'oklch(0.62 0.16 145 / 0.32)',
        }
      : tone === 'danger'
        ? {
            fg: 'var(--danger)',
            bg: 'oklch(0.55 0.2 25 / 0.06)',
            border: 'oklch(0.55 0.2 25 / 0.35)',
          }
        : {
            fg: 'var(--mute)',
            bg: 'var(--bg)',
            border: 'var(--line)',
          }
  return (
    <div
      className="ts-12 mt-3 flex items-start gap-2 rounded p-3"
      style={{
        color: palette.fg,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  )
}

export function EmptyPanel({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div
      className="mt-4 rounded p-6 text-center"
      style={{
        background: 'var(--bg)',
        border: '1px dashed var(--line2)',
      }}
    >
      <div
        className="mx-auto inline-flex items-center justify-center rounded"
        style={{
          width: 38,
          height: 38,
          background: 'var(--panel2)',
          border: '1px solid var(--line)',
          color: 'var(--mute)',
        }}
      >
        {icon}
      </div>
      <div className="ts-13 mt-3" style={{ color: 'var(--text)', fontWeight: 600 }}>
        {title}
      </div>
      <div className="ts-12 mt-1" style={{ color: 'var(--mute2)' }}>
        {body}
      </div>
    </div>
  )
}

export function StatusPill({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode
  label: string
  tone: 'success' | 'warning' | 'neutral'
}) {
  const palette =
    tone === 'success'
      ? {
          fg: 'oklch(0.62 0.16 145)',
          bg: 'oklch(0.62 0.16 145 / 0.08)',
          border: 'oklch(0.62 0.16 145 / 0.32)',
        }
      : tone === 'warning'
        ? {
            fg: 'var(--warn)',
            bg: 'oklch(0.68 0.16 70 / 0.1)',
            border: 'oklch(0.68 0.16 70 / 0.35)',
          }
        : {
            fg: 'var(--mute)',
            bg: 'var(--bg)',
            border: 'var(--line)',
          }
  return (
    <span
      className="ts-11 mono inline-flex items-center gap-1.5 rounded px-2 py-1"
      style={{
        color: palette.fg,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      {icon}
      {label}
    </span>
  )
}

export function PreviewTable({ rows }: { rows: ParsedRow[] }) {
  const columns = useMemo(() => deriveColumns(rows), [rows])

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table
        className="ts-12"
        style={{
          width: '100%',
          minWidth: 680,
          borderCollapse: 'separate',
          borderSpacing: 0,
        }}
      >
        <thead>
          <tr style={{ color: 'var(--mute)' }}>
            <th
              className="ts-11 mono px-3 py-2 text-left"
              style={{ borderBottom: '1px solid var(--line)', width: 70 }}
            >
              Row
            </th>
            {columns.map((c) => (
              <th
                key={c}
                className="ts-11 mono px-3 py-2 text-left"
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lineNumber}>
              <td
                className="px-3 py-2 mono align-top"
                style={{
                  color: 'var(--mute2)',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                {r.lineNumber}
              </td>
              {r.row === null ? (
                <td
                  colSpan={Math.max(columns.length, 1)}
                  className="px-3 py-2 ts-11 mono align-top"
                  style={{
                    color: 'var(--danger)',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  {r.error}
                </td>
              ) : (
                columns.map((c) => (
                  <td
                    key={c}
                    className="px-3 py-2 mono align-top"
                    style={{
                      color: 'var(--text)',
                      maxWidth: 220,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      borderBottom: '1px solid var(--line)',
                    }}
                    title={renderCell((r.row as Record<string, unknown>)[c])}
                  >
                    {renderCell((r.row as Record<string, unknown>)[c])}
                  </td>
                ))
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
