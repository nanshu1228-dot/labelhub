/**
 * Official template — 偏好对比标注 (preference_compare).
 *
 * Mirrors the spec's `preference_compare/标注要求.md` field table.
 * The pairwise preference layout: prompt above + A/B responses side
 * by side, then human picks A / B / tie + explains why.
 *
 * Field IDs are stable so the seed script can refer to them.
 */

import type { FormSchema } from '../schema'

export const PREFERENCE_COMPARE_TEMPLATE: FormSchema = {
  version: 1,
  fields: [
    {
      id: 'show_prompt',
      kind: 'show-item',
      label: '用户输入 (prompt)',
      config: { sourcePath: 'prompt', renderAs: 'auto' },
      validation: [],
    },
    {
      id: 'show_response_a',
      kind: 'show-item',
      label: '回答 A',
      config: { sourcePath: 'response_a', renderAs: 'auto' },
      validation: [],
    },
    {
      id: 'show_response_b',
      kind: 'show-item',
      label: '回答 B',
      config: { sourcePath: 'response_b', renderAs: 'auto' },
      validation: [],
    },
    {
      id: 'preferred',
      kind: 'single-select',
      label: '偏好结论',
      helperText: '三选一：A 更优 / B 更优 / 平局',
      config: {
        layout: 'horizontal',
        options: [
          { value: 'A', label: 'A 更优' },
          { value: 'B', label: 'B 更优' },
          { value: 'tie', label: '平局 (tie)' },
        ],
      },
      validation: [{ kind: 'required' }],
    },
    {
      id: 'margin',
      kind: 'single-select',
      label: '优势程度 (margin)',
      config: {
        layout: 'horizontal',
        options: [
          { value: 'clear', label: '明显优于' },
          { value: 'slight', label: '略优于' },
          { value: 'even', label: '相当' },
        ],
      },
      validation: [{ kind: 'required' }],
    },
    {
      id: 'safety_flag',
      kind: 'single-select',
      label: '是否安全风险 (safety_flag)',
      helperText: '任一方含违规内容时置「是」',
      config: {
        layout: 'horizontal',
        options: [
          { value: 'false', label: '否' },
          { value: 'true', label: '是' },
        ],
      },
      validation: [{ kind: 'required' }],
    },
    {
      id: 'dimensions',
      kind: 'multi-select',
      label: '判断依据维度',
      helperText: '可多选',
      config: {
        options: [
          { value: 'relevance', label: '相关性' },
          { value: 'accuracy', label: '准确性' },
          { value: 'safety', label: '安全性' },
          { value: 'completeness', label: '完整性' },
          { value: 'readability', label: '可读性' },
          { value: 'creativity', label: '创意性' },
          { value: 'fluency', label: '地道性' },
        ],
        minSelected: 1,
        maxSelected: null,
      },
      validation: [],
    },
    {
      id: 'one_line_conclusion',
      kind: 'text',
      label: '一句话结论',
      config: { placeholder: '简要说明偏好倾向' },
      validation: [
        { kind: 'required' },
        { kind: 'max-length', value: 200 },
      ],
    },
    {
      id: 'annotator_note',
      kind: 'textarea',
      label: '判断理由 (annotator_note)',
      helperText: '指向具体差异点的详细说明（必填）',
      config: { rows: 5 },
      validation: [{ kind: 'required' }],
    },
    {
      id: 'revision_suggestion',
      kind: 'rich-text',
      label: '改写 / 修订建议',
      helperText: '对更优回答给出带格式的优化建议',
      config: { toolbar: ['bold', 'italic', 'link', 'list'] },
      validation: [],
    },
    {
      id: 'structured_note_json',
      kind: 'json-editor',
      label: '结构化批注 (JSON)',
      helperText: '以结构化形式记录评分明细或更优回答的修订',
      config: { mode: 'json' },
      validation: [],
    },
    {
      id: 'evidence_upload',
      kind: 'file-upload',
      label: '证据素材',
      helperText: '上传佐证截图或附件（可选）',
      config: {
        accept: ['image/*', 'application/pdf'],
        maxSizeMb: 10,
        maxFiles: 5,
      },
      validation: [],
    },
    {
      id: 'ai_prejudge',
      kind: 'llm-trigger',
      label: 'AI 预判参考',
      helperText: '调用 Claude 预测偏好结论与理由',
      config: {
        buttonLabel: '让 AI 预判',
        promptTemplate:
          '基于上方的 prompt + response_a + response_b，判断 A / B / tie 哪个更优并说明理由。结论填入字段「一句话结论」的格式。',
        targetFieldId: 'annotator_note',
        tier: 'fast',
      },
      validation: [],
    },
  ],
}
