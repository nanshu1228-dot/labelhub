/**
 * Official template gallery — Finals D19-C.
 *
 * Curated `FormSchema` starting points the Designer "Start from
 * template" dropdown offers. Each template is the FormSchema
 * output the D4 serializer would produce had a PM hand-built the
 * form — so loading it directly into the canvas is byte-equivalent
 * to importing a real saved schema.
 *
 * Both templates land in the dropdown verbatim; the seed script
 * (D19-D) consumes them via `getTemplate(id)` to bootstrap the
 * demo workspace.
 *
 * Adding a template:
 *   1. New file `./<id>.ts` exporting a typed FormSchema.
 *   2. Register here in OFFICIAL_TEMPLATES.
 *   3. Re-run the in-module Zod validation (this file imports the
 *      `formSchemaSchema` parser and asserts on each entry — a bad
 *      schema throws at module load, NOT at runtime).
 */

import { formSchemaSchema, type FormSchema } from '../schema'
import { QA_QUALITY_TEMPLATE } from './qa-quality'
import { PREFERENCE_COMPARE_TEMPLATE } from './preference-compare'

export interface OfficialTemplate {
  id: string
  label: string
  description: string
  /** Suggested scoring dimensions for the AI Review Agent. */
  aiDimensions: Array<{ id: string; name: string; description?: string }>
  schema: FormSchema
}

export const OFFICIAL_TEMPLATES: ReadonlyArray<OfficialTemplate> = [
  {
    id: 'qa-quality',
    label: '问答质量标注 (qa_quality)',
    description:
      '为模型回答按相关性 / 准确性 / 格式合规 / 安全性四个维度打分，并标记问题类型。支持图片 / 视频 / Markdown 多媒体题目。',
    aiDimensions: [
      { id: 'relevance', name: '相关性' },
      { id: 'accuracy', name: '准确性' },
      { id: 'format', name: '格式合规' },
      { id: 'safety', name: '安全性' },
    ],
    schema: QA_QUALITY_TEMPLATE,
  },
  {
    id: 'preference-compare',
    label: '偏好对比标注 (preference_compare)',
    description:
      '两路模型回答 A/B 二选一 + 平局，附判断维度与详细理由，用于训练奖励模型 / 偏好对齐。',
    aiDimensions: [
      { id: 'relevance', name: '相关性' },
      { id: 'accuracy', name: '准确性' },
      { id: 'safety', name: '安全性' },
      { id: 'completeness', name: '完整性' },
      { id: 'readability', name: '可读性' },
    ],
    schema: PREFERENCE_COMPARE_TEMPLATE,
  },
]

/**
 * Validate every template against the canonical FormSchema parser
 * at module-load. A typo in a hand-rolled template throws an
 * `Error` here instead of corrupting Designer state at runtime.
 *
 * The cost is one-time, ~1ms total. Acceptable as a startup
 * invariant.
 */
for (const t of OFFICIAL_TEMPLATES) {
  const parsed = formSchemaSchema.safeParse(t.schema)
  if (!parsed.success) {
    throw new Error(
      `[templates] official template '${t.id}' failed FormSchema validation: ${parsed.error.message}`,
    )
  }
}

export function getTemplate(id: string): OfficialTemplate | undefined {
  return OFFICIAL_TEMPLATES.find((t) => t.id === id)
}

export function listTemplates(): ReadonlyArray<
  Pick<OfficialTemplate, 'id' | 'label' | 'description'>
> {
  return OFFICIAL_TEMPLATES.map(({ id, label, description }) => ({
    id,
    label,
    description,
  }))
}

export { QA_QUALITY_TEMPLATE, PREFERENCE_COMPARE_TEMPLATE }
