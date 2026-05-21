import type { FieldKind } from '@/lib/form-designer/schema'
import type { Material } from './types'
import { textFieldMaterial } from './text-field'
import { textareaFieldMaterial } from './textarea-field'
import { singleSelectFieldMaterial } from './single-select-field'
import { multiSelectFieldMaterial } from './multi-select-field'
import { richTextFieldMaterial } from './rich-text-field'
import { fileUploadFieldMaterial } from './file-upload-field'
import { jsonEditorFieldMaterial } from './json-editor-field'
import { llmTriggerFieldMaterial } from './llm-trigger-field'
import { showItemFieldMaterial } from './show-item-field'

/**
 * Material registry — Finals P1 D3.
 *
 * Single source of truth for the 9 widget materials. The palette
 * (D3), canvas previews (D3), property panel (D4), and Renderer (D6)
 * all consume one of `MATERIALS[kind]`. Adding a 10th material =
 * write a new file under `./` and register one line here.
 *
 * Container kinds ('group', 'tab-layout') are NOT in this registry —
 * they're layout primitives the Designer treats specially in D5.
 */
export const MATERIALS = {
  text: textFieldMaterial,
  textarea: textareaFieldMaterial,
  'single-select': singleSelectFieldMaterial,
  'multi-select': multiSelectFieldMaterial,
  'rich-text': richTextFieldMaterial,
  'file-upload': fileUploadFieldMaterial,
  'json-editor': jsonEditorFieldMaterial,
  'llm-trigger': llmTriggerFieldMaterial,
  'show-item': showItemFieldMaterial,
} as const

export type RegisteredKind = keyof typeof MATERIALS

/** Ordered list for palette rendering (groups + tab-layout excluded). */
export const PALETTE_ORDER: RegisteredKind[] = [
  'text',
  'textarea',
  'single-select',
  'multi-select',
  'rich-text',
  'file-upload',
  'json-editor',
  'llm-trigger',
  'show-item',
]

/**
 * Lookup helper — returns `undefined` for container kinds (group,
 * tab-layout) so callers can pattern-match the layout case
 * separately.
 */
export function getMaterial(kind: FieldKind): Material | undefined {
  return (MATERIALS as Record<string, Material>)[kind]
}
