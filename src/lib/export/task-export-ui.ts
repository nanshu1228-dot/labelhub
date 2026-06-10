import type { FieldMapping } from './formatters'

export type TaskExportFormat = 'json' | 'jsonl' | 'csv' | 'excel'
export type TaskExportPreset = 'full' | 'training' | 'review'
export type TaskExportFieldGroup = 'core' | 'data' | 'review'

export interface TaskExportFieldDef {
  source: string
  target: string
  label: string
  group: TaskExportFieldGroup
  transform?: FieldMapping['transform']
}

export const TASK_EXPORT_FIELD_GROUP_LABELS: Record<
  TaskExportFieldGroup,
  string
> = {
  core: 'Core',
  data: 'Data',
  review: 'Review',
}

export const TASK_EXPORT_FIELDS: TaskExportFieldDef[] = [
  {
    source: 'annotation_id',
    target: 'annotation_id',
    label: 'Annotation ID',
    group: 'core',
  },
  { source: 'topic_id', target: 'topic_id', label: 'Topic ID', group: 'core' },
  { source: 'task_id', target: 'task_id', label: 'Task ID', group: 'core' },
  {
    source: 'task_name',
    target: 'task_name',
    label: 'Task name',
    group: 'core',
  },
  {
    source: 'template_mode',
    target: 'template_mode',
    label: 'Template mode',
    group: 'core',
  },
  {
    source: 'workspace_id',
    target: 'workspace_id',
    label: 'Workspace ID',
    group: 'core',
  },
  {
    source: 'submitter_user_id',
    target: 'submitter_user_id',
    label: 'Submitter ID',
    group: 'core',
  },
  {
    source: 'submitter_email',
    target: 'submitter_email',
    label: 'Submitter',
    group: 'core',
  },
  {
    source: 'submitter_display_name',
    target: 'submitter_display_name',
    label: 'Submitter name',
    group: 'core',
  },
  {
    source: 'submitted_at',
    target: 'submitted_at',
    label: 'Submitted at',
    group: 'core',
  },
  {
    source: 'topic_status',
    target: 'topic_status',
    label: 'Topic status',
    group: 'core',
  },
  {
    source: 'topic_item_data',
    target: 'topic_item_data_json',
    label: 'Topic data',
    group: 'data',
    transform: 'json_stringify',
  },
  {
    source: 'payload',
    target: 'payload_json',
    label: 'Answer payload',
    group: 'data',
    transform: 'json_stringify',
  },
  {
    source: 'reasoning_text',
    target: 'reasoning_text',
    label: 'Reasoning',
    group: 'data',
  },
  {
    source: 'delta_summary',
    target: 'delta_summary',
    label: 'Delta summary',
    group: 'data',
  },
  {
    source: 'step_annotations',
    target: 'step_annotations_json',
    label: 'Step marks',
    group: 'data',
    transform: 'json_stringify',
  },
  {
    source: 'ai_review_status',
    target: 'ai_review_status',
    label: 'AI status',
    group: 'review',
  },
  {
    source: 'ai_review_verdict',
    target: 'ai_review_verdict',
    label: 'AI verdict',
    group: 'review',
  },
  {
    source: 'ai_review_score',
    target: 'ai_review_score',
    label: 'AI score',
    group: 'review',
  },
  {
    source: 'ai_review_reasoning',
    target: 'ai_review_reasoning',
    label: 'AI reasoning',
    group: 'review',
  },
  {
    source: 'ai_review_attempts',
    target: 'ai_review_attempts',
    label: 'AI attempts',
    group: 'review',
  },
  {
    source: 'ai_review_error',
    target: 'ai_review_error',
    label: 'AI error',
    group: 'review',
  },
  {
    source: 'ai_review_started_at',
    target: 'ai_review_started_at',
    label: 'AI started',
    group: 'review',
  },
  {
    source: 'ai_review_finished_at',
    target: 'ai_review_finished_at',
    label: 'AI finished',
    group: 'review',
  },
  {
    source: 'human_review_type',
    target: 'human_review_type',
    label: 'Human type',
    group: 'review',
  },
  {
    source: 'human_review_decision',
    target: 'human_review_decision',
    label: 'Human decision',
    group: 'review',
  },
  {
    source: 'human_review_feedback',
    target: 'human_review_feedback',
    label: 'Human feedback',
    group: 'review',
  },
  {
    source: 'human_review_role',
    target: 'human_review_role',
    label: 'Reviewer role',
    group: 'review',
  },
  {
    source: 'reviewed_at',
    target: 'reviewed_at',
    label: 'Reviewed at',
    group: 'review',
  },
  {
    source: 'review_event_count',
    target: 'review_event_count',
    label: 'Audit count',
    group: 'review',
  },
  {
    source: 'review_events',
    target: 'review_events_json',
    label: 'Audit events',
    group: 'review',
    transform: 'json_stringify',
  },
]

const PRESET_SOURCES: Record<TaskExportPreset, string[]> = {
  full: TASK_EXPORT_FIELDS.map((field) => field.source),
  training: [
    'annotation_id',
    'topic_id',
    'task_name',
    'template_mode',
    'topic_item_data',
    'payload',
    'ai_review_verdict',
    'human_review_decision',
  ],
  review: [
    'annotation_id',
    'topic_id',
    'submitter_email',
    'submitted_at',
    'topic_status',
    'payload',
    'ai_review_status',
    'ai_review_verdict',
    'ai_review_score',
    'ai_review_reasoning',
    'ai_review_error',
    'ai_review_started_at',
    'ai_review_finished_at',
    'human_review_decision',
    'human_review_feedback',
    'reviewed_at',
    'review_event_count',
    'review_events',
  ],
}

export function fieldsForTaskExportPreset(
  preset: TaskExportPreset,
): TaskExportFieldDef[] {
  const sources = new Set(PRESET_SOURCES[preset])
  return TASK_EXPORT_FIELDS.filter((field) => sources.has(field.source))
}

export function normalizeTaskExportMapping(
  fields: TaskExportFieldDef[],
  targetOverrides: Record<string, string> = {},
): FieldMapping[] {
  return fields.map((field) => {
    const target = targetOverrides[field.source]?.trim() || field.target
    return {
      source: field.source,
      target,
      ...(field.transform ? { transform: field.transform } : {}),
    }
  })
}

export function buildTaskExportHref(opts: {
  workspaceId: string
  taskId: string
  format: TaskExportFormat
  mapping?: FieldMapping[]
}): string {
  const params = new URLSearchParams({ format: opts.format })
  if (opts.mapping && opts.mapping.length > 0) {
    params.set('mapping', JSON.stringify(opts.mapping))
  }
  return `/api/workspaces/${opts.workspaceId}/tasks/${opts.taskId}/export?${params.toString()}`
}
