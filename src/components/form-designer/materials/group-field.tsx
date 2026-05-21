'use client'

import {
  TextRow,
  ToggleRow,
} from '@/components/form-designer/properties/primitives'
import type { Material } from './types'

/**
 * Group container — Finals P1 D5. The simplest container: a single
 * vertical list of children. Spec calls out "字段分组" by name.
 *
 * The Designer renders the group's children inline on the canvas via
 * the nested SortableContext path in designer-shell.tsx (D5). The
 * Renderer (D6) treats the group as an `object` JSON Schema with a
 * `properties` map; payload values live under `formValues[groupId]`.
 */
type GroupConfig = {
  /** Whether the group renders as a labelled card with a title bar. */
  showTitle?: boolean
  /** Layout column count for children — 1 (default) or 2. */
  columns?: number
  /** Optional description rendered below the title. */
  description?: string
}

export const groupFieldMaterial: Material = {
  kind: 'group',
  name: 'Group',
  icon: '▣',
  defaultConfig: {
    showTitle: true,
    columns: 1,
    description: '',
  } satisfies GroupConfig,
  designerPreview: ({ field }) => {
    const cfg = field.config as GroupConfig
    const childCount = field.children?.length ?? 0
    return (
      <div
        className="ts-12 mono"
        style={{
          color: 'var(--mute)',
          cursor: 'grab',
        }}
      >
        § GROUP · {childCount} child field{childCount === 1 ? '' : 'ren'}
        {cfg.showTitle === false ? ' · no title' : ''}
        {(cfg.columns ?? 1) > 1 ? ` · ${cfg.columns} cols` : ''}
      </div>
    )
  },
  propertyPanel: ({ field, onChange }) => {
    const cfg = field.config as GroupConfig
    function patch(next: Partial<GroupConfig>) {
      onChange({ ...field, config: { ...cfg, ...next } })
    }
    return (
      <>
        <ToggleRow
          label="Show title"
          hint="Hide for invisible logical grouping."
          value={cfg.showTitle ?? true}
          onChange={(v) => patch({ showTitle: v })}
        />
        <TextRow
          label="Description"
          value={cfg.description ?? ''}
          onChange={(v) => patch({ description: v })}
          placeholder="Optional helper line for the group"
          multiline
        />
      </>
    )
  },
}
