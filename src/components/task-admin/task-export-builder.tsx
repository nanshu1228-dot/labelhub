'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import {
  CheckSquare,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  ListChecks,
  Rows3,
} from 'lucide-react'
import {
  TASK_EXPORT_FIELDS,
  TASK_EXPORT_FIELD_GROUP_LABELS,
  buildTaskExportHref,
  fieldsForTaskExportPreset,
  normalizeTaskExportMapping,
  type TaskExportFieldDef,
  type TaskExportFieldGroup,
  type TaskExportFormat,
  type TaskExportPreset,
} from '@/lib/export/task-export-ui'

const FORMATS: Array<{
  value: TaskExportFormat
  label: string
  icon: LucideIcon
}> = [
  { value: 'json', label: 'JSON', icon: FileJson },
  { value: 'jsonl', label: 'JSONL', icon: FileJson },
  { value: 'csv', label: 'CSV', icon: FileSpreadsheet },
  { value: 'excel', label: 'Excel', icon: FileSpreadsheet },
]

const PRESETS: Array<{
  value: TaskExportPreset
  label: string
  icon: LucideIcon
}> = [
  { value: 'full', label: 'Full', icon: ListChecks },
  { value: 'training', label: 'Training', icon: Rows3 },
  { value: 'review', label: 'Review', icon: CheckSquare },
]

export function TaskExportBuilder({
  workspaceId,
  taskId,
}: {
  workspaceId: string
  taskId: string
}) {
  const [format, setFormat] = useState<TaskExportFormat>('jsonl')
  const [preset, setPreset] = useState<TaskExportPreset | 'custom'>('full')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(fieldsForTaskExportPreset('full').map((field) => field.source)),
  )
  const [targets, setTargets] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      TASK_EXPORT_FIELDS.map((field) => [field.source, field.target]),
    ),
  )

  const selectedFields = useMemo(
    () => TASK_EXPORT_FIELDS.filter((field) => selected.has(field.source)),
    [selected],
  )
  const mapping = useMemo(
    () => normalizeTaskExportMapping(selectedFields, targets),
    [selectedFields, targets],
  )
  const href = buildTaskExportHref({
    workspaceId,
    taskId,
    format,
    mapping,
  })

  function applyPreset(nextPreset: TaskExportPreset) {
    setPreset(nextPreset)
    setSelected(
      new Set(
        fieldsForTaskExportPreset(nextPreset).map((field) => field.source),
      ),
    )
  }

  function toggleField(source: string) {
    setPreset('custom')
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(source)) {
        next.delete(source)
      } else {
        next.add(source)
      }
      return next
    })
  }

  function setTarget(source: string, target: string) {
    setTargets((prev) => ({ ...prev, [source]: target }))
  }

  return (
    <div className="grid gap-4">
      <SegmentedControl
        label="Format"
        items={FORMATS}
        value={format}
        onChange={setFormat}
      />

      <SegmentedControl
        label="Preset"
        items={PRESETS}
        value={preset}
        onChange={applyPreset}
      />

      <div
        className="rounded"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          maxHeight: 360,
          overflow: 'auto',
        }}
      >
        {(['core', 'data', 'review'] satisfies TaskExportFieldGroup[]).map(
          (group) => (
            <FieldGroup
              key={group}
              group={group}
              selected={selected}
              targets={targets}
              onToggle={toggleField}
              onTargetChange={setTarget}
            />
          ),
        )}
      </div>

      <a
        href={href}
        className="ts-12 mono inline-flex items-center justify-center gap-2 rounded px-3"
        style={{
          minHeight: 40,
          color: 'white',
          background: selectedFields.length > 0 ? 'var(--accent)' : 'var(--mute2)',
          border: '1px solid var(--accent)',
          textDecoration: 'none',
          pointerEvents: selectedFields.length > 0 ? 'auto' : 'none',
          opacity: selectedFields.length > 0 ? 1 : 0.65,
        }}
      >
        <Download size={14} />
        Download mapped {format.toUpperCase()}
      </a>

      <Link
        href="/admin/exports"
        className="ts-12 mono inline-flex items-center justify-between gap-2 rounded px-3"
        style={{
          minHeight: 40,
          color: 'var(--text)',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          textDecoration: 'none',
        }}
      >
        <span>Delivery console</span>
        <ExternalLink size={13} />
      </Link>
    </div>
  )
}

function SegmentedControl<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string
  items: Array<{ value: T; label: string; icon: LucideIcon }>
  value: string
  onChange: (value: T) => void
}) {
  return (
    <div>
      <div className="lbl mb-2" style={{ color: 'var(--mute2)' }}>
        {label}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) => {
          const Icon = item.icon
          const active = item.value === value
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded px-2"
              style={{
                minHeight: 34,
                background: active ? 'var(--accent-soft)' : 'var(--panel)',
                color: active ? 'var(--accent)' : 'var(--mute)',
                border: `1px solid ${
                  active ? 'var(--accent-line)' : 'var(--line)'
                }`,
                cursor: 'pointer',
              }}
            >
              <Icon size={13} />
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FieldGroup({
  group,
  selected,
  targets,
  onToggle,
  onTargetChange,
}: {
  group: TaskExportFieldGroup
  selected: Set<string>
  targets: Record<string, string>
  onToggle: (source: string) => void
  onTargetChange: (source: string, target: string) => void
}) {
  const fields = TASK_EXPORT_FIELDS.filter((field) => field.group === group)
  return (
    <div>
      <div
        className="ts-11 mono px-3 py-2"
        style={{
          color: 'var(--mute2)',
          borderBottom: '1px solid var(--line)',
          background: 'var(--panel)',
        }}
      >
        {TASK_EXPORT_FIELD_GROUP_LABELS[group]}
      </div>
      {fields.map((field) => (
        <FieldRow
          key={field.source}
          field={field}
          checked={selected.has(field.source)}
          target={targets[field.source] ?? field.target}
          onToggle={onToggle}
          onTargetChange={onTargetChange}
        />
      ))}
    </div>
  )
}

function FieldRow({
  field,
  checked,
  target,
  onToggle,
  onTargetChange,
}: {
  field: TaskExportFieldDef
  checked: boolean
  target: string
  onToggle: (source: string) => void
  onTargetChange: (source: string, target: string) => void
}) {
  return (
    <div
      className="grid gap-2 px-3 py-2"
      style={{ borderBottom: '1px solid var(--line)' }}
    >
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(field.source)}
          style={{ width: 16, height: 16 }}
        />
        <span className="ts-12" style={{ color: 'var(--text)', fontWeight: 600 }}>
          {field.label}
        </span>
      </label>
      <input
        value={target}
        onChange={(event) => onTargetChange(field.source, event.target.value)}
        className="ts-11 mono rounded px-2"
        disabled={!checked}
        aria-label={`${field.label} export column`}
        style={{
          minHeight: 30,
          background: checked ? 'var(--panel)' : 'var(--panel2)',
          border: '1px solid var(--line)',
          color: checked ? 'var(--text)' : 'var(--mute2)',
          outline: 'none',
        }}
      />
    </div>
  )
}
