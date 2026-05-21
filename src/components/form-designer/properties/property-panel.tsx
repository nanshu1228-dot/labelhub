'use client'

/**
 * Property panel router — Finals P1 D4.
 *
 * Right-pane editor. Picks the selected field's material from the
 * registry and renders:
 *
 *   1. CommonFieldHeader  — label / helperText / id / delete
 *   2. material.propertyPanel — per-kind config editors
 *   3. ValidationListEditor — shared `field.validation` rules
 *
 * Containers (group / tab-layout) ship in D5 — until then the router
 * renders a "container — D5" placeholder for those kinds, matching the
 * canvas preview's existing fallback.
 */

import type { FieldNode } from '@/lib/form-designer/schema'
import { getMaterial } from '@/components/form-designer/materials/registry'
import {
  CommonFieldHeader,
  ValidationListEditor,
} from './common-rows'

export function PropertyPanel({
  field,
  onChange,
  onDelete,
}: {
  field: FieldNode
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
      {mat ? (
        Panel ? (
          <div className="flex flex-col gap-3">
            <div
              className="lh-mono lh-caption"
              style={{ color: 'var(--mute)' }}
            >
              {mat.name.toUpperCase()} CONFIG
            </div>
            <Panel field={field} onChange={onChange} />
          </div>
        ) : null
      ) : (
        <p
          className="ts-12"
          style={{ color: 'var(--mute2)' }}
        >
          Container properties land in D5.
        </p>
      )}
      <ValidationListEditor field={field} onChange={onChange} />
    </div>
  )
}
