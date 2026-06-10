import { z } from 'zod'
import type { PlatformTemplate } from '../types'
import { registerTemplate } from '../registry'

/**
 * Custom Designer — Finals P1 (D2-D6).
 *
 * The first template whose shape is NOT baked in. The PM (admin) opens
 * /admin/forms/new, drags 9 (D3) → 11 (D5) widgets onto a canvas, sets
 * linkage + validation + group/tab containers, and saves the resulting
 * FormSchema to `custom_form_schemas`.
 *
 * Tasks created with `templateMode: 'custom-designer'` carry
 * `templateConfig.formSchemaId` referencing the saved row; the Labeler
 * (/topics/[id]/annotate) loads the schema and mounts <FormRenderer>.
 *
 * Why not bake this in as a hard-coded schema:
 *   - Validation is delegated to the SAVED schema, not a per-mode Zod
 *   - itemSchema and responseSchema are both intentionally permissive;
 *     the Renderer's compileFormValidator() handles per-field checks
 *     at submit time from the user's rules
 *
 * The decision to leave itemSchema generous (any object) rests on:
 *   - PMs author item data via the Designer (show-item widgets resolve
 *     `topic.itemData.<path>`) and our Zod here can't anticipate that
 *   - The serializer in `src/lib/form-designer/serialize.ts` already
 *     enforces the FormSchema shape on save; runtime parse is cheap
 *
 * Workflow: includes the new `ai_review` stage from the D1 enum
 * extension so AI Review Agent (P2) verdicts route this template too.
 */

const itemSchema = z.record(z.string(), z.unknown()).default({})

const responseSchema = z.record(z.string(), z.unknown()).default({})

export const customDesignerTemplate: PlatformTemplate = {
  mode: 'custom-designer',
  name: 'Custom Designer',
  description:
    'PM-defined visual form schema. Drag-drop the 11 widgets onto a canvas; the Renderer hydrates topic.itemData and the Labeler fills the rest. Validation is delegated to the saved schema.',
  itemSchema,
  responseSchema,
  workflow: [
    'drafting',
    'revising',
    'submitted',
    // D7 extends with 'ai_review' once that stage joins the
    // workflowStageSchema enum — left out here so workflow stays
    // compile-safe ahead of P2.
    'reviewing',
    'awaiting_acceptance',
    'approved',
    'rejected',
  ],
  perfBudget: {
    // Forms with hundreds of fields are out of scope for D6; once the
    // Renderer virtualizes (P6) we can lift this. Cap at 30 to satisfy
    // the registry's "past 30 → virtualize" guard until then.
    maxItemsPerCell: 30,
    virtualizationRequired: false,
    atomicStateRequired: false,
    autoSavePolicy: 'on-blur',
    maxResponseLengthChars: 16000,
  },
  economy: {
    type: 'cash-per-item',
    currency: 'CNY',
    qualityMultiplierMin: 1.0,
    qualityMultiplierMax: 1.5,
  },
  ui: { theme: 'minimal', layout: 'single-column' },
}

registerTemplate(customDesignerTemplate)
