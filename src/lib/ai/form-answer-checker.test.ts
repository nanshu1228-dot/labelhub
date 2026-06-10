import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * form-answer-checker — pre-submit AI sanity check for custom-designer
 * forms. Mock the LLM; pin that the structured warnings parse and an
 * empty/solid draft yields no warnings.
 */

vi.mock('@/lib/ai/client', () => ({ chat: vi.fn() }))

import { chat } from '@/lib/ai/client'
import { checkFormAnswers } from './form-answer-checker'

const mockChat = vi.mocked(chat)
function reply(obj: unknown) {
  mockChat.mockResolvedValue({
    text: JSON.stringify(obj),
    usage: { model: 'test-model', inputTokens: 5, outputTokens: 7 },
  } as never)
}

const FIELDS = [
  { id: 'rating', label: '相关性', kind: 'single-select', required: true },
  { id: 'note', label: '总评', kind: 'text', required: true },
]

beforeEach(() => vi.clearAllMocks())

describe('checkFormAnswers', () => {
  it('surfaces structured warnings from the model', async () => {
    reply({
      summary: '总评偏薄,建议补充。',
      warnings: [
        { code: 'empty_required', severity: 'warn', message: '总评未填', fieldId: 'note' },
        { code: 'thin', severity: 'info', message: '理由过短' },
      ],
    })
    const { check } = await checkFormAnswers({
      taskGuidelines: '按相关性打分',
      itemData: { prompt: 'q', model_answer: 'a' },
      fields: FIELDS,
      values: { rating: '5', note: '' },
    })
    expect(check.warnings).toHaveLength(2)
    expect(check.warnings[0]).toMatchObject({ code: 'empty_required', fieldId: 'note' })
    expect(check.summary).toContain('总评')
  })

  it('returns no warnings for a solid draft', async () => {
    reply({ summary: '看起来不错。', warnings: [] })
    const { check } = await checkFormAnswers({
      taskGuidelines: '',
      itemData: {},
      fields: FIELDS,
      values: { rating: '5', note: '回答相关、准确、表述清晰。' },
    })
    expect(check.warnings).toHaveLength(0)
    expect(check.summary).toBeTruthy()
  })

  it('throws on non-JSON output', async () => {
    mockChat.mockResolvedValue({
      text: 'here are my thoughts in prose',
      usage: { model: 't', inputTokens: 1, outputTokens: 1 },
    } as never)
    await expect(
      checkFormAnswers({ taskGuidelines: '', itemData: {}, fields: FIELDS, values: {} }),
    ).rejects.toThrow(/non-JSON/)
  })
})
