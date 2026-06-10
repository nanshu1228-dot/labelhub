import type { FieldKind } from '@/lib/form-designer/schema'
import type { Material } from './types'
import { textFieldMaterial } from './text-field'
import { textareaFieldMaterial } from './textarea-field'
import { singleSelectFieldMaterial } from './single-select-field'
import { multiSelectFieldMaterial } from './multi-select-field'
import { tagSelectFieldMaterial } from './tag-select-field'
import { richTextFieldMaterial } from './rich-text-field'
import { fileUploadFieldMaterial } from './file-upload-field'
import { jsonEditorFieldMaterial } from './json-editor-field'
import { llmTriggerFieldMaterial } from './llm-trigger-field'
import { showItemFieldMaterial } from './show-item-field'
import { groupFieldMaterial } from './group-field'
import { tabLayoutFieldMaterial } from './tab-layout-field'

/**
 * Material registry — Finals P1 D5.
 *
 * Single source of truth for the 12 widget materials. The palette
 * (D3), canvas previews (D3), property panel (D4), and Renderer (D6)
 * all consume one of `MATERIALS[kind]`. Adding a 12th material =
 * write a new file under `./` and register one line here.
 *
 * Container kinds ('group', 'tab-layout') joined the registry in D5
 * with their own designerPreview + propertyPanel. The Designer's
 * canvas-shell renders their nested children through a nested
 * SortableContext (see designer-shell.tsx).
 */
export const MATERIALS = {
  text: textFieldMaterial,
  textarea: textareaFieldMaterial,
  'single-select': singleSelectFieldMaterial,
  'multi-select': multiSelectFieldMaterial,
  'tag-select': tagSelectFieldMaterial,
  'rich-text': richTextFieldMaterial,
  'file-upload': fileUploadFieldMaterial,
  'json-editor': jsonEditorFieldMaterial,
  'llm-trigger': llmTriggerFieldMaterial,
  'show-item': showItemFieldMaterial,
  group: groupFieldMaterial,
  'tab-layout': tabLayoutFieldMaterial,
} as const

export type RegisteredKind = keyof typeof MATERIALS

/** Ordered list for palette rendering. Containers sit at the bottom. */
export const PALETTE_ORDER: RegisteredKind[] = [
  'text',
  'textarea',
  'single-select',
  'multi-select',
  'tag-select',
  'rich-text',
  'file-upload',
  'json-editor',
  'llm-trigger',
  'show-item',
  'group',
  'tab-layout',
]

/** Lookup helper for non-registry callers (Renderer / serializer). */
export function getMaterial(kind: FieldKind): Material | undefined {
  return (MATERIALS as Record<string, Material>)[kind]
}

/** True iff this kind nests children that the Designer must walk. */
export function isContainerKind(kind: FieldKind): boolean {
  return kind === 'group' || kind === 'tab-layout'
}
