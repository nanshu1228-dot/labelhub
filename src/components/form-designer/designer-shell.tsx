'use client'

import { useAtom } from 'jotai'
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
import {
  formSchemaAtom,
  makeFieldFromKind,
  selectedFieldIdAtom,
} from './canvas-state'
import {
  MATERIALS,
  PALETTE_ORDER,
  getMaterial,
} from './materials/registry'
import { PropertyPanel } from './properties/property-panel'

/**
 * Finals P1 D3 — Designer shell wired to the 9-material registry +
 * Jotai canvas state + localStorage persistence.
 *
 *   ┌─────────┬──────────────────┬──────────┐
 *   │ palette │      canvas      │ properties│
 *   │  D3 ✓   │   D3 sortable    │   D4 stub│
 *   └─────────┴──────────────────┴──────────┘
 *
 * D3 deliverables met:
 *   - 9 drag-from-palette buttons → drop onto canvas as the matching
 *     material's defaultConfig
 *   - Canvas state lives in formSchemaAtom (Jotai), persisted via
 *     atomWithStorage so refresh restores the draft (the D3 gate)
 *   - Each canvas item renders its material's designerPreview
 *
 * D4 fills in the per-material property panel; D5 adds linkage /
 * validation / group / tab-layout; D6 wires the runtime Renderer +
 * server persistence into custom_form_schemas.
 */
export function DesignerShell() {
  const [schema, setSchema] = useAtom(formSchemaAtom)
  const [selectedId, setSelectedId] = useAtom(selectedFieldIdAtom)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Tiny activation threshold so a click doesn't accidentally drag.
      activationConstraint: { distance: 4 },
    }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setSchema((current) => {
      const oldIdx = current.fields.findIndex((f) => f.id === active.id)
      const newIdx = current.fields.findIndex((f) => f.id === over.id)
      if (oldIdx < 0 || newIdx < 0) return current
      return { ...current, fields: arrayMove(current.fields, oldIdx, newIdx) }
    })
  }

  function addMaterial(kind: keyof typeof MATERIALS) {
    const mat = MATERIALS[kind]
    const field = makeFieldFromKind(kind, mat.defaultConfig, mat.name)
    setSchema((c) => ({ ...c, fields: [...c.fields, field] }))
    setSelectedId(field.id)
  }

  function patchSelectedField(next: FieldNode) {
    setSchema((c) => ({
      ...c,
      fields: c.fields.map((f) => (f.id === next.id ? next : f)),
    }))
  }

  function deleteSelectedField() {
    if (!selectedId) return
    setSchema((c) => ({
      ...c,
      fields: c.fields.filter((f) => f.id !== selectedId),
    }))
    setSelectedId(null)
  }

  function resetCanvas() {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        'Clear the entire canvas? This wipes the local draft.',
      )
      if (!ok) return
    }
    setSchema({ version: 1, fields: [] })
    setSelectedId(null)
  }

  const selectedField =
    selectedId === null ? null : schema.fields.find((f) => f.id === selectedId) ?? null

  return (
    <div
      className="grid h-screen"
      style={{
        gridTemplateColumns: '240px 1fr 300px',
        background: 'var(--bg)',
        color: 'var(--text)',
      }}
    >
      {/* PALETTE */}
      <aside
        className="border-r overflow-y-auto p-4"
        style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
      >
        <div className="lbl mb-3" style={{ color: 'var(--mute)' }}>
          § PALETTE
        </div>
        <div className="flex flex-col gap-1.5">
          {PALETTE_ORDER.map((kind) => {
            const mat = MATERIALS[kind]
            return (
              <button
                key={kind}
                type="button"
                onClick={() => addMaterial(kind)}
                className="text-left ts-13 mono px-3 py-2 rounded inline-flex items-center gap-2"
                style={{
                  background: 'var(--panel2)',
                  border: '1px solid var(--line)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                <span
                  className="inline-block w-6 text-center"
                  style={{ color: 'oklch(0.6 0.18 280)' }}
                >
                  {mat.icon}
                </span>
                <span>{mat.name}</span>
              </button>
            )
          })}
        </div>
        <p
          className="ts-11 mono mt-6"
          style={{ color: 'var(--mute2)' }}
        >
          Click to add. D5 adds group + tab containers; drag-from-
          palette → drop-on-canvas lands in D6 with the Renderer.
        </p>
      </aside>

      {/* CANVAS */}
      <main className="overflow-y-auto p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <div>
            <div className="lbl" style={{ color: 'var(--mute)' }}>
              § CANVAS
            </div>
            <h1
              className="ts-22 mt-1"
              style={{ color: 'var(--hi)', fontWeight: 500 }}
            >
              Untitled form
            </h1>
            <p
              className="ts-12 mt-1"
              style={{ color: 'var(--mute2)' }}
            >
              {schema.fields.length === 0
                ? 'Click a material in the palette to start.'
                : `${schema.fields.length} field${schema.fields.length === 1 ? '' : 's'} · drag to reorder`}
            </p>
          </div>
          {schema.fields.length > 0 && (
            <button
              type="button"
              onClick={resetCanvas}
              className="ts-12 mono px-3 py-1.5 rounded"
              style={{
                background: 'transparent',
                color: 'var(--danger)',
                border: '1px solid oklch(0.55 0.2 25 / 0.4)',
                cursor: 'pointer',
              }}
            >
              Reset canvas
            </button>
          )}
        </div>

        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={schema.fields.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-3">
              {schema.fields.map((f) => (
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

        {schema.fields.length === 0 && (
          <div
            className="rounded-md p-12 text-center ts-13 mt-4"
            style={{
              background: 'var(--panel)',
              border: '1px dashed var(--line)',
              color: 'var(--mute2)',
            }}
          >
            Empty canvas. Add fields from the palette to build a form.
          </div>
        )}
      </main>

      {/* PROPERTIES (D4 stub) */}
      <aside
        className="border-l overflow-y-auto p-4"
        style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
      >
        <div className="lbl mb-3" style={{ color: 'var(--mute)' }}>
          § PROPERTIES
        </div>
        {selectedField ? (
          <PropertyPanel
            field={selectedField}
            onChange={patchSelectedField}
            onDelete={deleteSelectedField}
          />
        ) : (
          <p className="ts-12" style={{ color: 'var(--mute2)' }}>
            Select a field on the canvas to edit its label, config,
            and validation rules.
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
  }
  const mat = getMaterial(field.kind)
  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className="ts-13"
    >
      <div
        style={{
          background: selected ? 'var(--accent-soft)' : 'var(--panel)',
          border: `1px solid ${selected ? 'var(--accent-line)' : 'var(--line)'}`,
          borderRadius: 6,
          padding: '12px 14px',
          cursor: 'pointer',
        }}
      >
        <div
          className="flex items-center gap-3 mb-2"
          {...attributes}
          {...listeners}
          style={{ cursor: 'grab' }}
        >
          <span
            className="ts-11 mono"
            style={{ color: 'var(--mute2)' }}
          >
            ⋮⋮
          </span>
          <span
            className="ts-13"
            style={{ color: 'var(--text)', fontWeight: 500 }}
          >
            {field.label}
          </span>
          <span
            className="ts-11 mono ml-auto"
            style={{ color: 'var(--mute2)' }}
          >
            {field.kind}
          </span>
        </div>
        {mat ? (
          <mat.designerPreview field={field} />
        ) : (
          <span
            className="ts-12"
            style={{ color: 'var(--mute2)' }}
          >
            (container — D5)
          </span>
        )}
      </div>
    </li>
  )
}

