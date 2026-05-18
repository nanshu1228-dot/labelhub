import { describe, expect, it } from 'vitest'
import {
  reshapeTeaching,
  type RawManifestItem,
} from './teaching-reshape'

/**
 * Maintenance-pass test coverage for the teaching-signal reshape used
 * by /api/export/dataset?format=teaching. Pure function — no DB,
 * no IO.
 */

function rawItem(
  overrides: Partial<RawManifestItem> = {},
): RawManifestItem {
  return {
    annotationId: 'ann-1',
    topicId: 'topic-1',
    taskId: 'task-1',
    userId: 'user-1',
    payload: { ratings: { r1: { a: true, b: false } } },
    claudeProposal: { ratings: { r1: { a: false, b: false } } },
    deltaSummary: 'Human flipped a from false to true',
    reasoningText: 'Model A is more direct',
    itemData: { prompt: 'What is metformin?' },
    submittedAt: '2026-05-18T12:00:00Z',
    templateMode: 'pair-rubric',
    ...overrides,
  }
}

describe('reshapeTeaching — skip rules', () => {
  it('returns null when claudeProposal is missing', () => {
    expect(reshapeTeaching(rawItem({ claudeProposal: undefined }))).toBeNull()
  })

  it('returns null when claudeProposal is explicitly null', () => {
    expect(reshapeTeaching(rawItem({ claudeProposal: null }))).toBeNull()
  })

  it('returns null on non-object input', () => {
    expect(reshapeTeaching(null)).toBeNull()
    expect(reshapeTeaching('not an item')).toBeNull()
    expect(reshapeTeaching(123)).toBeNull()
  })

  it('returns a record when claudeProposal is falsy but defined (false/0/empty)', () => {
    // `null`/`undefined` mean "no AI proposal".
    // false/0/empty-array/empty-object are valid AI outputs and must
    // not be skipped.
    expect(reshapeTeaching(rawItem({ claudeProposal: false }))).not.toBeNull()
    expect(reshapeTeaching(rawItem({ claudeProposal: 0 }))).not.toBeNull()
    expect(reshapeTeaching(rawItem({ claudeProposal: {} }))).not.toBeNull()
    expect(reshapeTeaching(rawItem({ claudeProposal: [] }))).not.toBeNull()
  })
})

describe('reshapeTeaching — prompt extraction', () => {
  it('extracts `prompt` first', () => {
    const r = reshapeTeaching(
      rawItem({ itemData: { prompt: 'P', question: 'Q' } }),
    )
    expect(r?.prompt).toBe('P')
  })

  it('falls back to `question`', () => {
    const r = reshapeTeaching(
      rawItem({ itemData: { question: 'Q', text: 'T' } }),
    )
    expect(r?.prompt).toBe('Q')
  })

  it('falls back to `input_text`', () => {
    const r = reshapeTeaching(
      rawItem({ itemData: { input_text: 'IT' } }),
    )
    expect(r?.prompt).toBe('IT')
  })

  it('falls back to `text`', () => {
    const r = reshapeTeaching(rawItem({ itemData: { text: 'TX' } }))
    expect(r?.prompt).toBe('TX')
  })

  it('skips empty-string prompts to next candidate', () => {
    const r = reshapeTeaching(
      rawItem({ itemData: { prompt: '', question: 'Q' } }),
    )
    expect(r?.prompt).toBe('Q')
  })

  it('returns null prompt when no recognized key + non-string values', () => {
    const r = reshapeTeaching(
      rawItem({
        itemData: { custom_field: { nested: 'value' }, prompt: 42 },
      }),
    )
    expect(r?.prompt).toBeNull()
  })

  it('returns null prompt when itemData is missing', () => {
    const r = reshapeTeaching(rawItem({ itemData: undefined }))
    expect(r?.prompt).toBeNull()
  })
})

describe('reshapeTeaching — output shape', () => {
  it('preserves the raw itemData in source.itemData (audit trail)', () => {
    const itemData = { prompt: 'P', custom: { nested: 'x' } }
    const r = reshapeTeaching(rawItem({ itemData }))
    expect(r?.source.itemData).toEqual(itemData)
  })

  it('passes through claudeProposal as ai_proposal verbatim', () => {
    const cp = { ratings: { r1: { a: true } }, customField: 'x' }
    const r = reshapeTeaching(rawItem({ claudeProposal: cp }))
    expect(r?.ai_proposal).toEqual(cp)
  })

  it('passes through payload as human_correction verbatim', () => {
    const p = { ratings: { r1: { a: false } }, notes: 'hmm' }
    const r = reshapeTeaching(rawItem({ payload: p }))
    expect(r?.human_correction).toEqual(p)
  })

  it('null-coerces missing deltaSummary / reasoningText', () => {
    const r = reshapeTeaching(
      rawItem({ deltaSummary: undefined, reasoningText: undefined }),
    )
    expect(r?.delta_summary).toBeNull()
    expect(r?.reasoning).toBeNull()
  })

  it('id equals annotationId', () => {
    const r = reshapeTeaching(rawItem({ annotationId: 'ann-xyz' }))
    expect(r?.id).toBe('ann-xyz')
  })

  it('template_mode is passed through', () => {
    expect(
      reshapeTeaching(rawItem({ templateMode: 'arena-gsb' }))
        ?.template_mode,
    ).toBe('arena-gsb')
    expect(
      reshapeTeaching(rawItem({ templateMode: 'agent-trace-eval' }))
        ?.template_mode,
    ).toBe('agent-trace-eval')
  })

  it('source carries the provenance fields, not training features', () => {
    const r = reshapeTeaching(rawItem())
    expect(r?.source).toEqual({
      annotationId: 'ann-1',
      topicId: 'topic-1',
      taskId: 'task-1',
      raterUserId: 'user-1',
      submittedAt: '2026-05-18T12:00:00Z',
      itemData: { prompt: 'What is metformin?' },
    })
  })

  it('source.itemData is null when itemData was undefined', () => {
    const r = reshapeTeaching(rawItem({ itemData: undefined }))
    expect(r?.source.itemData).toBeNull()
  })
})
