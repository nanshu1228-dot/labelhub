'use client'

/**
 * Designer canvas state — Finals P1 D3.
 *
 * Jotai atom holding the in-progress FormSchema. Persists to
 * localStorage so a tab refresh restores work (the D3 gate). D6
 * swaps the storage backend for Dexie + server-action save against
 * `custom_form_schemas`.
 *
 * `atomWithStorage` from jotai/utils takes a (key, default) pair and
 * mirrors writes to localStorage on the client; SSR sees the default.
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import {
  EMPTY_FORM,
  type FieldKind,
  type FieldNode,
  type FormSchema,
} from '@/lib/form-designer/schema'
import { arrayMove } from '@dnd-kit/sortable'

const STORAGE_KEY = 'lh.designer.draft.v1'

/**
 * Persisted draft form schema. atomWithStorage runs both reads + writes
 * through localStorage; SSR hydration uses EMPTY_FORM (the canvas
 * renders empty for a microsecond before client-side hydrate fills
 * the actual saved state).
 */
export const formSchemaAtom = atomWithStorage<FormSchema>(
  STORAGE_KEY,
  EMPTY_FORM,
)

/** Currently-selected field ID (drives the property panel). */
export const selectedFieldIdAtom = atom<string | null>(null)

/**
 * Generate a short, sortable ID for a new field. Crypto-random the
 * suffix so two fields added in the same millisecond don't collide.
 */
export function newFieldId(): string {
  const ts = Date.now().toString(36)
  // 4 random bytes → 8 hex chars
  const rand =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(4)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      : Math.floor(Math.random() * 0xffffffff)
          .toString(16)
          .padStart(8, '0')
  return `f_${ts}_${rand}`
}

/**
 * Build a FieldNode from a palette drop. Material's defaultConfig is
 * cloned (deep) so two drops of the same material don't share config
 * references and confuse the canvas state.
 *
 * Container kinds (group, tab-layout) get an empty `children` array so
 * the canvas's nested SortableContext renders them immediately. The
 * Designer drops a single starter tab into tab-layout for usability.
 */
export function makeFieldFromKind(
  kind: FieldKind,
  defaultConfig: Record<string, unknown>,
  defaultLabel: string,
): FieldNode {
  const node: FieldNode = {
    id: newFieldId(),
    kind,
    label: defaultLabel,
    config: structuredClone(defaultConfig),
    validation: [],
  }
  if (kind === 'group') {
    node.children = []
  } else if (kind === 'tab-layout') {
    const starterTabId = newFieldId()
    node.children = [
      {
        id: starterTabId,
        kind: 'group',
        label: 'Tab 1',
        config: { showTitle: false, columns: 1 },
        validation: [],
        children: [],
      },
    ]
  }
  return node
}

/**
 * Walk the schema tree and return the parent array that owns the
 * given id, plus the node's index within it. Returns undefined if the
 * id is not present anywhere.
 *
 * For root-level fields the "parent" is the schema.fields array; for
 * container children it's `container.children`. The Designer's
 * handleDragEnd uses this to confirm both active + over are siblings.
 */
export interface LocateResult {
  parentId: string | null // null = root
  index: number
}

export function locateField(
  fields: FieldNode[],
  id: string,
  parentId: string | null = null,
): LocateResult | undefined {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    if (f.id === id) return { parentId, index: i }
    if (f.children) {
      const hit = locateField(f.children, id, f.id)
      if (hit) return hit
    }
  }
  return undefined
}

/**
 * Immutable update: replace the children array (or top-level fields)
 * of the parent identified by `parentId`. Returns a fresh FormSchema
 * with the new array in place.
 */
export function setChildrenAt(
  schema: FormSchema,
  parentId: string | null,
  nextChildren: FieldNode[],
): FormSchema {
  if (parentId === null) {
    return { ...schema, fields: nextChildren }
  }
  return {
    ...schema,
    fields: schema.fields.map((f) =>
      replaceContainerChildren(f, parentId, nextChildren),
    ),
  }
}

function replaceContainerChildren(
  node: FieldNode,
  parentId: string,
  nextChildren: FieldNode[],
): FieldNode {
  if (node.id === parentId) {
    return { ...node, children: nextChildren }
  }
  if (!node.children) return node
  return {
    ...node,
    children: node.children.map((c) =>
      replaceContainerChildren(c, parentId, nextChildren),
    ),
  }
}

/**
 * Walk to the node with the given id and return the array of fields
 * at its level (its siblings, including itself). Used by the property
 * panel to drive the linkage dropdown — linkage targets must come
 * from the same canvas level.
 */
export function siblingsOf(
  schema: FormSchema,
  id: string,
): FieldNode[] {
  const loc = locateField(schema.fields, id)
  if (!loc) return []
  if (loc.parentId === null) return schema.fields
  const parent = findNode(schema.fields, loc.parentId)
  return parent?.children ?? []
}

function findNode(fields: FieldNode[], id: string): FieldNode | undefined {
  for (const f of fields) {
    if (f.id === id) return f
    if (f.children) {
      const hit = findNode(f.children, id)
      if (hit) return hit
    }
  }
  return undefined
}

/** Immutable patch: replace a node anywhere in the tree by id. */
export function patchField(
  schema: FormSchema,
  next: FieldNode,
): FormSchema {
  return {
    ...schema,
    fields: schema.fields.map((f) => replaceNode(f, next)),
  }
}

function replaceNode(node: FieldNode, next: FieldNode): FieldNode {
  if (node.id === next.id) return next
  if (!node.children) return node
  return {
    ...node,
    children: node.children.map((c) => replaceNode(c, next)),
  }
}

/** Immutable delete: drop a node anywhere in the tree by id. */
export function deleteField(schema: FormSchema, id: string): FormSchema {
  return {
    ...schema,
    fields: schema.fields
      .filter((f) => f.id !== id)
      .map((f) => deleteFromSubtree(f, id)),
  }
}

function deleteFromSubtree(node: FieldNode, id: string): FieldNode {
  if (!node.children) return node
  return {
    ...node,
    children: node.children
      .filter((c) => c.id !== id)
      .map((c) => deleteFromSubtree(c, id)),
  }
}

/**
 * Reorder siblings inside whatever parent currently owns `activeId`.
 * Returns the schema unchanged if active + over don't share a parent
 * (cross-container moves are out of scope for D5 — the Designer
 * handles those in D6 with a richer drag-state model).
 */
export function reorderSiblings(
  schema: FormSchema,
  activeId: string,
  overId: string,
): FormSchema {
  if (activeId === overId) return schema
  const a = locateField(schema.fields, activeId)
  const b = locateField(schema.fields, overId)
  if (!a || !b) return schema
  if (a.parentId !== b.parentId) return schema
  const parentChildren =
    a.parentId === null
      ? schema.fields
      : (findNode(schema.fields, a.parentId)?.children ?? [])
  const next = arrayMove(parentChildren, a.index, b.index)
  return setChildrenAt(schema, a.parentId, next)
}

/** Append a child to a specific container's children array. */
export function appendChildTo(
  schema: FormSchema,
  parentId: string | null,
  child: FieldNode,
): FormSchema {
  if (parentId === null) {
    return { ...schema, fields: [...schema.fields, child] }
  }
  const parent = findNode(schema.fields, parentId)
  if (!parent) return schema
  return setChildrenAt(schema, parentId, [...(parent.children ?? []), child])
}
