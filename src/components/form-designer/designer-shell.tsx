'use client'

import { useState } from 'react'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { FieldNode } from '@/lib/form-designer/schema'
import { EMPTY_FORM } from '@/lib/form-designer/schema'

/**
 * Finals P1 D2 — three-pane Designer shell.
 *
 *   ┌─────────┬──────────────────┬──────────┐
 *   │ palette │      canvas      │ properties│
 *   │  (D3)   │  (sortable list) │   (D4)   │
 *   └─────────┴──────────────────┴──────────┘
 *
 * This file is the **D2 SMOKE TEST** for the React 19 + Next 16 +
 * @dnd-kit pipeline. The canvas accepts drops from a tiny built-in
 * palette and the sortable list rearranges them. No persistence, no
 * material registry yet — those land in D3-D6.
 *
 * If dnd-kit interactions hang or hydration breaks in production
 * Turbopack, that's the D2 risk and we fall back to react-dnd before
 * proceeding to D3.
 */
export function DesignerShell() {
  const [fields, setFields] = useState<FieldNode[]>(EMPTY_FORM.fields)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Tiny activation threshold so a click doesn't accidentally drag.
      activationConstraint: { distance: 4 },
    }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setFields((current) => {
      const oldIdx = current.findIndex((f) => f.id === active.id)
      const newIdx = current.findIndex((f) => f.id === over.id)
      if (oldIdx < 0 || newIdx < 0) return current
      return arrayMove(current, oldIdx, newIdx)
    })
  }

  function addStubField(kind: 'text' | 'textarea') {
    const id = `field_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`
    setFields((c) => [
      ...c,
      {
        id,
        kind,
        label: kind === 'text' ? 'Text field' : 'Textarea',
        config: {},
        validation: [],
      },
    ])
    setSelectedId(id)
  }

  return (
    <div
      className="grid h-screen"
      style={{
        gridTemplateColumns: '220px 1fr 280px',
        background: 'var(--bg)',
        color: 'var(--text)',
      }}
    >
      {/* PALETTE — D3 expands this into the 9-widget library */}
      <aside
        className="border-r overflow-y-auto p-4"
        style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
      >
        <div className="lbl mb-3" style={{ color: 'var(--mute)' }}>
          § PALETTE (D2 stub)
        </div>
        <button
          type="button"
          onClick={() => addStubField('text')}
          className="block w-full text-left ts-13 mono mb-2 px-3 py-2 rounded"
          style={{
            background: 'var(--panel2)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
          }}
        >
          + Text field
        </button>
        <button
          type="button"
          onClick={() => addStubField('textarea')}
          className="block w-full text-left ts-13 mono mb-2 px-3 py-2 rounded"
          style={{
            background: 'var(--panel2)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
          }}
        >
          + Textarea
        </button>
        <p
          className="ts-11 mono mt-6"
          style={{ color: 'var(--mute2)' }}
        >
          D3 adds the 9-material drag-from-palette → drop-on-canvas
          flow. Today is the dnd-kit + React 19 smoke.
        </p>
      </aside>

      {/* CANVAS — sortable list, dnd-kit smoke surface */}
      <main className="overflow-y-auto p-6">
        <div className="mb-4">
          <div className="lbl" style={{ color: 'var(--mute)' }}>
            § CANVAS
          </div>
          <h1
            className="ts-22 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            Untitled form
          </h1>
          <p className="ts-12 mt-1" style={{ color: 'var(--mute2)' }}>
            {fields.length === 0
              ? 'Drag widgets from the palette to start.'
              : `${fields.length} field${fields.length === 1 ? '' : 's'} · drag to reorder`}
          </p>
        </div>

        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={fields.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-2">
              {fields.map((f) => (
                <SortableField
                  key={f.id}
                  field={f}
                  selected={f.id === selectedId}
                  onClick={() => setSelectedId(f.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        {fields.length === 0 && (
          <div
            className="rounded-md p-12 text-center ts-13 mt-4"
            style={{
              background: 'var(--panel)',
              border: '1px dashed var(--line)',
              color: 'var(--mute2)',
            }}
          >
            Empty canvas. Click a palette button on the left to add a
            placeholder field, then drag to reorder.
          </div>
        )}
      </main>

      {/* PROPERTIES — D4 expands this into the per-material editor */}
      <aside
        className="border-l overflow-y-auto p-4"
        style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
      >
        <div className="lbl mb-3" style={{ color: 'var(--mute)' }}>
          § PROPERTIES (D4 stub)
        </div>
        {selectedId ? (
          <SelectedFieldProps
            field={fields.find((f) => f.id === selectedId) ?? null}
            onChange={(next) =>
              setFields((c) =>
                c.map((f) => (f.id === selectedId ? next : f)),
              )
            }
            onDelete={() => {
              setFields((c) => c.filter((f) => f.id !== selectedId))
              setSelectedId(null)
            }}
          />
        ) : (
          <p className="ts-12" style={{ color: 'var(--mute2)' }}>
            Select a field on the canvas to edit its label.
          </p>
        )}
      </aside>
    </div>
  )
}

function SortableField({
  field,
  selected,
  onClick,
}: {
  field: FieldNode
  selected: boolean
  onClick: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
  }
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="rounded-md p-3 ts-13"
    >
      <div
        style={{
          background: selected ? 'var(--accent-soft)' : 'var(--panel)',
          border: `1px solid ${selected ? 'var(--accent-line)' : 'var(--line)'}`,
          borderRadius: 6,
          padding: '10px 14px',
        }}
      >
        <div className="flex items-baseline justify-between">
          <span style={{ color: 'var(--text)' }}>{field.label}</span>
          <span
            className="ts-11 mono"
            style={{ color: 'var(--mute2)' }}
          >
            {field.kind}
          </span>
        </div>
      </div>
    </li>
  )
}

function SelectedFieldProps({
  field,
  onChange,
  onDelete,
}: {
  field: FieldNode | null
  onChange: (next: FieldNode) => void
  onDelete: () => void
}) {
  if (!field) return null
  return (
    <div className="flex flex-col gap-3">
      <label className="ts-12">
        <div className="lbl mb-1" style={{ color: 'var(--mute)' }}>
          LABEL
        </div>
        <input
          type="text"
          value={field.label}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
          className="w-full ts-13 mono"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            borderRadius: 4,
            padding: '6px 10px',
            color: 'var(--text)',
          }}
        />
      </label>
      <div className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
        ID: <code>{field.id}</code>
        <br />
        Kind: <code>{field.kind}</code>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="ts-12 mono px-3 py-1.5 rounded"
        style={{
          background: 'transparent',
          color: 'var(--danger)',
          border: '1px solid oklch(0.55 0.2 25 / 0.4)',
          cursor: 'pointer',
        }}
      >
        Delete field
      </button>
    </div>
  )
}
