'use client'

/**
 * Property panel router — Finals P1 D4/D5.
 *
 * Right-pane editor. Picks the selected field's material from the
 * registry and renders:
 *
 *   1. CommonFieldHeader  — label / helperText / id / delete
 *   2. material.propertyPanel — per-kind config editors
 *   3. LinkageEditor       — visibleWhen / requiredWhen (D5)
 *   4. ValidationListEditor — shared `field.validation` rules
 *
 * Containers (group / tab-layout) joined the registry in D5; their
 * panels add the children-list management UI (group title toggle,
 * tab CRUD).
 */

import type { FieldNode } from '@/lib/form-designer/schema'
import { getMaterial } from '@/components/form-materials/registry'
import {
  CommonFieldHeader,
  ValidationListEditor,
} from './common-rows'
import { LinkageEditor } from './linkage-editor'

export function PropertyPanel({
  field,
  siblings,
  onChange,
  onDelete,
}: {
  field: FieldNode
  /** Other fields at the same canvas level — drive the linkage dropdown. */
  siblings: FieldNode[]
  onChange: (next: FieldNode) => void
  onDelete: () => void
}) {
  const mat = getMaterial(field.kind)
  const Panel = mat?.propertyPanel

  return (
    <div className="flex flex-col gap-5">
      <CommonFieldHeader
        field={field}
        onChange={onChange}
        onDelete={onDelete}
      />
      {mat && Panel ? (
        <div className="flex flex-col gap-3">
          <div
            className="lh-mono lh-caption"
            style={{ color: 'var(--mute)' }}
          >
            {mat.name.toUpperCase()} CONFIG
          </div>
          <Panel field={field} onChange={onChange} />
        </div>
      ) : (
        <p className="ts-12" style={{ color: 'var(--mute2)' }}>
          This material has no extra config.
        </p>
      )}
      <LinkageEditor
        field={field}
        siblings={siblings}
        onChange={onChange}
      />
      <ValidationListEditor field={field} onChange={onChange} />
    </div>
  )
}
