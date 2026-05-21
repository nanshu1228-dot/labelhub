/**
 * Material interface — Finals P1 D3.
 *
 * One Material per FIELD_KINDS entry. Each material exports:
 *
 *   - kind                : the FieldKind it implements (1:1)
 *   - name                : palette label
 *   - icon                : short emoji / 2-char hint for palette chip
 *   - defaultConfig       : initial Field.config when dragged from palette
 *   - designerPreview     : React component rendered in the canvas (D3+)
 *   - runtimeRenderer     : React component rendered in the Labeler form (D6)
 *   - propertyPanel       : per-material property editor (D4)
 *
 * D3 ships kind + name + icon + defaultConfig + designerPreview for all
 * 9 widgets. runtimeRenderer + propertyPanel are typed but optional;
 * D4 and D6 fill them in.
 *
 * Container kinds (group, tab-layout) are NOT registered as materials —
 * they're top-level layout primitives the Designer adds directly in D5.
 */

import type { ComponentType } from 'react'
import type { FieldKind, FieldNode } from '@/lib/form-designer/schema'

export interface DesignerPreviewProps {
  /** The field this preview is rendering. Read-only for the preview. */
  field: FieldNode
}

export interface RuntimeRendererProps {
  field: FieldNode
  /** Current value for this field in the form payload. */
  value: unknown
  /** Bubble a new value up. The Renderer wires this to autosave. */
  onChange: (next: unknown) => void
  /** Read-only flag — e.g. reviewer viewing a submitted annotation. */
  readOnly?: boolean
  /**
   * D10 — write a value into a sibling field. Used by `llm-trigger`
   * to stuff Claude's response into the configured `targetFieldId`.
   * The Renderer wires this with the parent form's full value-dict
   * setter; other materials can leave it unused.
   */
  onSetField?: (fieldId: string, next: unknown) => void
  /**
   * D10 — the full form value dict for the current scope (root or
   * group). `llm-trigger` reads it to build context for Claude;
   * other materials don't need it.
   */
  allValues?: Record<string, unknown>
  /**
   * D10 — topic.itemData for the current annotation, so an LLM
   * assist can include the prompt + reference text in its context.
   */
  itemData?: Record<string, unknown>
}

export interface PropertyPanelProps {
  field: FieldNode
  /** Patch the field; immutable updates only. */
  onChange: (next: FieldNode) => void
}

export interface Material {
  kind: FieldKind
  name: string
  /** Short visual token for palette chip — emoji or 1-2 char abbrev. */
  icon: string
  /** Per-material default `config` blob the canvas writes on drop. */
  defaultConfig: Record<string, unknown>
  /** What the canvas renders for this field (D3). */
  designerPreview: ComponentType<DesignerPreviewProps>
  /** What the Labeler sees at runtime (D6). Optional in D3. */
  runtimeRenderer?: ComponentType<RuntimeRendererProps>
  /** Per-material property panel (D4). Optional in D3. */
  propertyPanel?: ComponentType<PropertyPanelProps>
}
