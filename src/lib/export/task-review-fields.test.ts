import { describe, expect, it } from 'vitest'
import {
  buildTaskReviewExportFields,
  latestAiVerdictByAnnotation,
  reviewEventsByAnnotation,
  type TaskExportAiVerdictRow,
  type TaskExportReviewEventRow,
} from './task-review-fields'

describe('task export review fields', () => {
  it('picks the newest AI verdict per annotation', () => {
    const rows: TaskExportAiVerdictRow[] = [
      aiVerdict('ann-1', 'completed', 'send_back', 20, new Date('2026-01-01')),
      aiVerdict('ann-1', 'completed', 'pass', 92, new Date('2026-01-02')),
      aiVerdict('ann-2', 'failed', null, null, new Date('2026-01-01')),
    ]

    const grouped = latestAiVerdictByAnnotation(rows)

    expect(grouped.get('ann-1')?.verdict).toBe('pass')
    expect(grouped.get('ann-2')?.status).toBe('failed')
  })

  it('groups review events by annotation id and keeps chronological order', () => {
    const rows: TaskExportReviewEventRow[] = [
      event('annotation.approved', 'ann-1', new Date('2026-01-03')),
      event('ai_review.started', 'ann-1', new Date('2026-01-01')),
      event('annotation.revised', 'ann-2', new Date('2026-01-02')),
      { type: 'annotation.approved', actorId: null, payload: {}, ts: new Date() },
    ]

    const grouped = reviewEventsByAnnotation(rows)

    expect(grouped.get('ann-1')?.map((row) => row.type)).toEqual([
      'ai_review.started',
      'annotation.approved',
    ])
    expect(grouped.get('ann-2')?.map((row) => row.type)).toEqual([
      'annotation.revised',
    ])
  })

  it('builds export-ready AI, human review, and audit fields', () => {
    const fields = buildTaskReviewExportFields({
      annotationId: 'ann-1',
      aiVerdict: aiVerdict(
        'ann-1',
        'completed',
        'human_review',
        55,
        new Date('2026-01-01T10:00:00Z'),
        2,
      ),
      reviewEvents: [
        event('ai_review.completed', 'ann-1', new Date('2026-01-01T10:01:00Z'), {
          verdict: 'human_review',
          score: 55,
        }),
        event('annotation.qc_passed', 'ann-1', new Date('2026-01-01T10:05:00Z'), {
          decision: 'pass',
          feedback: 'QC looks good.',
          reviewerRole: 'qc',
        }),
        event('annotation.approved', 'ann-1', new Date('2026-01-01T10:10:00Z'), {
          decision: 'approve',
          feedback: 'Accepted for export.',
        }),
      ],
    })

    expect(fields.ai_review_status).toBe('completed')
    expect(fields.ai_review_verdict).toBe('human_review')
    expect(fields.ai_review_score).toBe(55)
    expect(fields.ai_review_attempts).toBe(2)
    expect(fields.human_review_type).toBe('annotation.approved')
    expect(fields.human_review_decision).toBe('approve')
    expect(fields.human_review_feedback).toBe('Accepted for export.')
    expect(fields.human_review_role).toBe('admin')
    expect(fields.review_event_count).toBe(3)
    expect(fields.review_events).toEqual([
      expect.objectContaining({ type: 'ai_review.completed', verdict: 'human_review' }),
      expect.objectContaining({ type: 'annotation.qc_passed', reviewer_role: 'qc' }),
      expect.objectContaining({ type: 'annotation.approved', decision: 'approve' }),
    ])
  })
})

function aiVerdict(
  annotationId: string,
  status: string,
  verdict: string | null,
  score: number | null,
  startedAt: Date,
  attempts = 1,
): TaskExportAiVerdictRow {
  return {
    annotationId,
    status,
    verdict,
    scores: score == null ? {} : { __score: score, completeness: score },
    reasoning: verdict ? 'AI reasoning' : null,
    attempts,
    errorText: status === 'failed' ? 'model failed' : null,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 1000),
  }
}

function event(
  type: string,
  annotationId: string,
  ts: Date,
  payload: Record<string, unknown> = {},
): TaskExportReviewEventRow {
  return {
    type,
    actorId: type.startsWith('ai_') ? null : 'reviewer-1',
    payload: { annotationId, ...payload },
    ts,
  }
}
