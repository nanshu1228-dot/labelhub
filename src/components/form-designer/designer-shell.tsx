'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { FieldNode } from '@/lib/form-designer/schema'
import {
  appendChildTo,
  deleteField,
  formSchemaAtom,
  locateField,
  makeFieldFromKind,
  patchField,
  reorderSiblings,
  selectedFieldIdAtom,
  siblingsOf,
} from './canvas-state'
import {
  MATERIALS,
  PALETTE_ORDER,
  getMaterial,
  isContainerKind,
} from '@/components/form-materials/registry'
import { PropertyPanel } from './properties/property-panel'

/**
 * Finals P1 D5 — Designer shell with nested SortableContext containers.
 *
 *   ┌─────────┬──────────────────┬──────────┐
 *   │ palette │   canvas (nest)  │ properties│
 *   │  D3 ✓   │   D5 group+tabs  │   D4/D5  │
 *   └─────────┴──────────────────┴──────────┘
 *
 * D5 deliverables met:
 *   - 11 palette buttons (D3 9 + group + tab-layout)
 *   - Containers render their children inline via a recursive
 *     SortableField, each wrapped in its own SortableContext so
 *     reorder works within the parent's scope
 *   - Cross-container drags are rejected — moving a field between
 *     parents arrives in D6 with a richer drag-state model
 *   - Property panel surfaces linkage (visibleWhen / requiredWhen)
 *     with sibling-aware dropdowns
 *   - Tab-layout previews active tab inline; tab switching is a
 *     designer-only ephemeral state (not persisted to formSchemaAtom)
 *
 * D6 fills in the runtime Renderer + server persistence into
 * custom_form_schemas.
 */
/**
 * Per-admin workspace option (passed from the server). Save targets one
 * workspace at a time; the picker shows label + id so the owner can
 * disambiguate two workspaces named the same.
 */
export interface DesignerWorkspaceOption {
  id: string
  name: string
}

/** Server actions invoked by the toolbar — kept loose so the shell stays client-only. */
export interface DesignerStorageActions {
  /** Create a new saved schema. Returns the row id for navigation. */
  save: (input: {
    workspaceId: string
    label: string
    schema: import('@/lib/form-designer/schema').FormSchema
  }) => Promise<{ id: string }>
  /** Overwrite an existing schema's content + label. */
  update?: (input: {
    id: string
    workspaceId: string
    label: string
    schema: import('@/lib/form-designer/schema').FormSchema
  }) => Promise<void>
}

export interface DesignerShellProps {
  /**
   * Workspaces the signed-in user can save into (admin role). When the
   * list has more than one, the Save dialog asks the owner to pick;
   * empty list disables the Save button (read-only Designer mode).
   */
  workspaces?: DesignerWorkspaceOption[]
  /**
   * Already-loaded schema to seed the canvas. Used by the edit
   * /admin/forms/[id] page; new-form page leaves this undefined so
   * the localStorage draft (atomWithStorage) takes over.
   */
  initialSchema?: {
    id: string
    workspaceId: string
    label: string
    schema: import('@/lib/form-designer/schema').FormSchema
  }
  /** Server actions; absent on the read-only preview embed. */
  storage?: DesignerStorageActions
  /** Path to navigate to after save (default /admin/forms). */
  postSaveHref?: string
}

export function DesignerShell({
  workspaces = [],
  initialSchema,
  storage,
  postSaveHref = '/admin/forms',
}: DesignerShellProps = {}) {
  const [schema, setSchema] = useAtom(formSchemaAtom)
  const [selectedId, setSelectedId] = useAtom(selectedFieldIdAtom)
  /** Map tab-layout id → currently focused tab id (designer-only UI state). */
  const [activeTabBy, setActiveTabBy] = useState<Record<string, string>>({})
  const [savePending, startSave] = useTransition()
  const [saveError, setSaveError] = useState<string | null>(null)
  const router = useRouter()

  /** Hydrate from the server-provided schema once (edit mode). */
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    if (!hydrated && initialSchema) {
      setSchema(initialSchema.schema)
      setHydrated(true)
    }
  }, [hydrated, initialSchema, setSchema])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Tiny activation threshold so a click doesn't accidentally drag.
      activationConstraint: { distance: 4 },
    }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    setSchema((current) => reorderSiblings(current, activeId, overId))
  }

  function addMaterial(kind: keyof typeof MATERIALS) {
    const mat = MATERIALS[kind]
    const field = makeFieldFromKind(kind, mat.defaultConfig, mat.name)
    setSchema((c) => ({ ...c, fields: [...c.fields, field] }))
    setSelectedId(field.id)
  }

  function patchSelectedField(next: FieldNode) {
    setSchema((c) => patchField(c, next))
  }

  function deleteSelectedField() {
    if (!selectedId) return
    setSchema((c) => deleteField(c, selectedId))
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

  /**
   * Add a child to a specific container. Used by the in-canvas
   * "+ Add field" affordance on each group / tab.
   */
  function addChildTo(parentId: string, kind: keyof typeof MATERIALS) {
    const mat = MATERIALS[kind]
    const field = makeFieldFromKind(kind, mat.defaultConfig, mat.name)
    setSchema((c) => appendChildTo(c, parentId, field))
    setSelectedId(field.id)
  }

  function setActiveTab(layoutId: string, tabId: string) {
    setActiveTabBy((m) => ({ ...m, [layoutId]: tabId }))
  }

  /** Persist the current canvas state through the parent-provided action. */
  function saveSchema() {
    if (!storage || workspaces.length === 0) return
    if (schema.fields.length === 0) {
      setSaveError('Add at least one field before saving.')
      return
    }
    const defaultLabel = initialSchema?.label ?? 'Untitled form'
    const label =
      typeof window === 'undefined'
        ? defaultLabel
        : window.prompt('Schema label', defaultLabel) ?? defaultLabel
    if (!label.trim()) {
      setSaveError('Label is required.')
      return
    }
    let workspaceId = initialSchema?.workspaceId
    if (!workspaceId) {
      if (workspaces.length === 1) {
        workspaceId = workspaces[0].id
      } else {
        const choices = workspaces
          .map((w, i) => `${i + 1}. ${w.name}`)
          .join('\n')
        const picked =
          typeof window === 'undefined'
            ? '1'
            : window.prompt(
                `Save into which workspace?\n${choices}`,
                '1',
              )
        const idx = Number(picked) - 1
        if (!Number.isInteger(idx) || idx < 0 || idx >= workspaces.length) {
          setSaveError('Invalid workspace selection.')
          return
        }
        workspaceId = workspaces[idx].id
      }
    }
    setSaveError(null)
    startSave(async () => {
      try {
        if (initialSchema && storage.update) {
          await storage.update({
            id: initialSchema.id,
            workspaceId: workspaceId!,
            label,
            schema,
          })
          router.refresh()
        } else {
          await storage.save({
            workspaceId: workspaceId!,
            label,
            schema,
          })
          router.push(postSaveHref)
        }
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Save failed.')
      }
    })
  }

  const selectedField =
    selectedId === null
      ? null
      : (locateField(schema.fields, selectedId)
          ? findInTree(schema.fields, selectedId)
          : null)

  const siblings =
    selectedId == null ? [] : siblingsOf(schema, selectedId)

  return (
    <div
      className="grid h-screen"
      style={{
        gridTemplateColumns: '240px 1fr 320px',
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
          Click to add. Drag fields within their parent to reorder.
          Cross-container drag lands in D6 with the Renderer.
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
                : `${countFields(schema.fields)} field${countFields(schema.fields) === 1 ? '' : 's'} · drag within parent to reorder`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              {storage && workspaces.length > 0 ? (
                <button
                  type="button"
                  onClick={saveSchema}
                  disabled={savePending || schema.fields.length === 0}
                  className="ts-12 mono px-3 py-1.5 rounded"
                  style={{
                    background:
                      savePending || schema.fields.length === 0
                        ? 'var(--panel2)'
                        : 'oklch(0.6 0.18 280)',
                    color:
                      savePending || schema.fields.length === 0
                        ? 'var(--mute2)'
                        : 'white',
                    border: '1px solid oklch(0.6 0.18 280 / 0.6)',
                    cursor:
                      savePending || schema.fields.length === 0
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  {savePending
                    ? 'Saving…'
                    : initialSchema
                      ? 'Update schema'
                      : 'Save schema'}
                </button>
              ) : null}
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
            {saveError ? (
              <span
                className="ts-11"
                style={{ color: 'var(--danger)' }}
              >
                {saveError}
              </span>
            ) : null}
          </div>
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
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onAddChild={addChildTo}
                  activeTabBy={activeTabBy}
                  onSetActiveTab={setActiveTab}
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

      {/* PROPERTIES */}
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
            siblings={siblings}
            onChange={patchSelectedField}
            onDelete={deleteSelectedField}
          />
        ) : (
          <p className="ts-12" style={{ color: 'var(--mute2)' }}>
            Select a field on the canvas to edit its label, config,
            linkage and validation rules.
          </p>
        )}
      </aside>
    </div>
  )
}

/** Recursive walker — find a node anywhere in the tree by id. */
function findInTree(fields: FieldNode[], id: string): FieldNode | null {
  for (const f of fields) {
    if (f.id === id) return f
    if (f.children) {
      const hit = findInTree(f.children, id)
      if (hit) return hit
    }
  }
  return null
}

/** Total field count (recursive — containers + children counted). */
function countFields(fields: FieldNode[]): number {
  let n = 0
  for (const f of fields) {
    n += 1
    if (f.children) n += countFields(f.children)
  }
  return n
}

function SortableField({
  field,
  selectedId,
  onSelect,
  onAddChild,
  activeTabBy,
  onSetActiveTab,
}: {
  field: FieldNode
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAddChild: (parentId: string, kind: keyof typeof MATERIALS) => void
  activeTabBy: Record<string, string>
  onSetActiveTab: (layoutId: string, tabId: string) => void
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
  const selected = field.id === selectedId
  const isContainer = isContainerKind(field.kind)
  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(field.id)
      }}
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
        {mat ? <mat.designerPreview field={field} /> : null}

        {isContainer ? (
          <ContainerChildren
            field={field}
            selectedId={selectedId}
            onSelect={onSelect}
            onAddChild={onAddChild}
            activeTabBy={activeTabBy}
            onSetActiveTab={onSetActiveTab}
          />
        ) : null}
      </div>
    </li>
  )
}

/**
 * Renders a container's children inline on the canvas. Each container
 * gets its own SortableContext keyed by the container's id so reorder
 * stays scoped to siblings.
 */
function ContainerChildren({
  field,
  selectedId,
  onSelect,
  onAddChild,
  activeTabBy,
  onSetActiveTab,
}: {
  field: FieldNode
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAddChild: (parentId: string, kind: keyof typeof MATERIALS) => void
  activeTabBy: Record<string, string>
  onSetActiveTab: (layoutId: string, tabId: string) => void
}) {
  if (field.kind === 'tab-layout') {
    const tabs = field.children ?? []
    const activeTabId =
      activeTabBy[field.id] ?? tabs[0]?.id ?? null
    const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
    return (
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onSetActiveTab(field.id, t.id)
                onSelect(t.id)
              }}
              className="ts-12 mono px-2 py-1 rounded"
              style={{
                background:
                  active?.id === t.id ? 'var(--accent-soft)' : 'var(--panel2)',
                border: `1px solid ${active?.id === t.id ? 'var(--accent-line)' : 'var(--line)'}`,
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              {t.label || t.id}
            </button>
          ))}
          {tabs.length === 0 ? (
            <span className="ts-11" style={{ color: 'var(--mute2)' }}>
              No tabs — use the property panel to add one.
            </span>
          ) : null}
        </div>
        {active ? (
          <NestedChildren
            parent={active}
            selectedId={selectedId}
            onSelect={onSelect}
            onAddChild={onAddChild}
            activeTabBy={activeTabBy}
            onSetActiveTab={onSetActiveTab}
          />
        ) : null}
      </div>
    )
  }

  return (
    <NestedChildren
      parent={field}
      selectedId={selectedId}
      onSelect={onSelect}
      onAddChild={onAddChild}
      activeTabBy={activeTabBy}
      onSetActiveTab={onSetActiveTab}
    />
  )
}

function NestedChildren({
  parent,
  selectedId,
  onSelect,
  onAddChild,
  activeTabBy,
  onSetActiveTab,
}: {
  parent: FieldNode
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAddChild: (parentId: string, kind: keyof typeof MATERIALS) => void
  activeTabBy: Record<string, string>
  onSetActiveTab: (layoutId: string, tabId: string) => void
}) {
  const children = parent.children ?? []
  return (
    <div
      className="mt-3 pl-3"
      style={{
        borderLeft: '2px solid var(--line)',
      }}
    >
      <SortableContext
        items={children.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-2">
          {children.map((c) => (
            <SortableField
              key={c.id}
              field={c}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              activeTabBy={activeTabBy}
              onSetActiveTab={onSetActiveTab}
            />
          ))}
        </ul>
      </SortableContext>
      <AddChildBar parentId={parent.id} onAddChild={onAddChild} />
    </div>
  )
}

function AddChildBar({
  parentId,
  onAddChild,
}: {
  parentId: string
  onAddChild: (parentId: string, kind: keyof typeof MATERIALS) => void
}) {
  return (
    <div
      className="mt-2 flex flex-wrap gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {(['text', 'textarea', 'single-select', 'multi-select'] as const).map(
        (k) => (
          <button
            key={k}
            type="button"
            onClick={() => onAddChild(parentId, k)}
            className="ts-11 mono px-2 py-1 rounded"
            style={{
              background: 'var(--panel2)',
              color: 'var(--text)',
              border: '1px solid var(--line)',
              cursor: 'pointer',
            }}
          >
            + {MATERIALS[k].name}
          </button>
        ),
      )}
    </div>
  )
}
