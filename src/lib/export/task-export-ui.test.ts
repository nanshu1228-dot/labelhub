import { describe, expect, it } from 'vitest'
import {
  buildTaskExportHref,
  fieldsForTaskExportPreset,
  normalizeTaskExportMapping,
} from './task-export-ui'

describe('task export UI helpers', () => {
  it('keeps the full preset aligned with review timing and actor metadata', () => {
    const sources = fieldsForTaskExportPreset('full').map((field) => field.source)

    expect(sources).toEqual(
      expect.arrayContaining([
        'workspace_id',
        'submitter_user_id',
        'submitter_display_name',
        'ai_review_error',
        'ai_review_started_at',
        'ai_review_finished_at',
      ]),
    )
  })

  it('builds a review preset that includes review audit events', () => {
    const fields = fieldsForTaskExportPreset('review')
    const mapping = normalizeTaskExportMapping(fields)

    expect(mapping).toContainEqual({
      source: 'review_events',
      target: 'review_events_json',
      transform: 'json_stringify',
    })
    expect(mapping.map((field) => field.source)).toContain(
      'human_review_feedback',
    )
    expect(mapping.map((field) => field.source)).toContain('ai_review_verdict')
  })

  it('applies target column overrides before serializing the href', () => {
    const fields = fieldsForTaskExportPreset('training')
    const mapping = normalizeTaskExportMapping(fields, {
      payload: 'answer',
      topic_item_data: 'input',
    })
    const href = buildTaskExportHref({
      workspaceId: 'w-1',
      taskId: 't-1',
      format: 'excel',
      mapping,
    })
    const url = new URL(`https://example.test${href}`)
    const serialized = url.searchParams.get('mapping')

    expect(url.pathname).toBe('/api/workspaces/w-1/tasks/t-1/export')
    expect(url.searchParams.get('format')).toBe('excel')
    expect(serialized).not.toBeNull()
    expect(JSON.parse(serialized as string)).toEqual(
      expect.arrayContaining([
        {
          source: 'payload',
          target: 'answer',
          transform: 'json_stringify',
        },
        {
          source: 'topic_item_data',
          target: 'input',
          transform: 'json_stringify',
        },
      ]),
    )
  })

  it('omits mapping when no fields are selected', () => {
    const href = buildTaskExportHref({
      workspaceId: 'w-1',
      taskId: 't-1',
      format: 'jsonl',
      mapping: [],
    })

    expect(href).toBe('/api/workspaces/w-1/tasks/t-1/export?format=jsonl')
  })
})
