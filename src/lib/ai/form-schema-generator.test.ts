import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * form-schema-generator — natural-language → a valid custom-designer
 * FormSchema. We mock the LLM client and pin that whatever the model
 * emits, the assembled schema is ALWAYS valid against the canonical
 * `formSchemaSchema` (per-kind config built by us, not the model).
 */

vi.mock('@/lib/ai/client', () => ({ chat: vi.fn() }))

import { chat } from '@/lib/ai/client'
import { generateFormSchema } from './form-schema-generator'
import { formSchemaSchema } from '@/lib/form-designer/schema'

const mockChat = vi.mocked(chat)
function reply(obj: unknown) {
  mockChat.mockResolvedValue({
    text: JSON.stringify(obj),
    usage: { model: 'test-model', inputTokens: 10, outputTokens: 20 },
  } as never)
}

beforeEach(() => vi.clearAllMocks())

describe('generateFormSchema', () => {
  it('builds a valid FormSchema from the model output', async () => {
    reply({
      summary: 'QA 质量打分',
      fields: [
        { id: 'show_prompt', kind: 'show-item', label: '用户问题', sourcePath: 'prompt' },
        { id: 'rating', kind: 'single-select', label: '相关性', required: true, options: ['1', '2', '3', '4', '5'] },
        { id: 'summary_note', kind: 'text', label: '一句话总评', required: true },
      ],
    })

    const { result } = await generateFormSchema({ description: '展示问题,按相关性打分,写总评' })

    // Always valid against the canonical schema.
    expect(formSchemaSchema.safeParse(result.schema).success).toBe(true)
    expect(result.schema.version).toBe(1)
    expect(result.schema.fields).toHaveLength(3)
    expect(result.summary).toBe('QA 质量打分')

    // show-item carries a sourcePath in config.
    const showItem = result.schema.fields.find((f) => f.kind === 'show-item')!
    expect(showItem.config.sourcePath).toBe('prompt')

    // select builds {value,label} options + required rule applied.
    const sel = result.schema.fields.find((f) => f.kind === 'single-select')!
    expect((sel.config.options as Array<{ value: string; label: string }>)[0]).toEqual({
      value: '1',
      label: '1',
    })
    expect(sel.validation).toEqual([{ kind: 'required' }])
  })

  it('de-dupes repeated field ids', async () => {
    reply({
      summary: 's',
      fields: [
        { id: 'a', kind: 'text', label: 'A' },
        { id: 'a', kind: 'text', label: 'A duplicate' },
        { id: 'b', kind: 'textarea', label: 'B' },
      ],
    })
    const { result } = await generateFormSchema({ description: 'two fields, dup id' })
    expect(result.schema.fields.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('defaults select options when the model omits them (still valid)', async () => {
    reply({ summary: 's', fields: [{ id: 'pick', kind: 'single-select', label: 'Pick one' }] })
    const { result } = await generateFormSchema({ description: 'a select without options' })
    expect((result.schema.fields[0].config.options as unknown[]).length).toBeGreaterThanOrEqual(2)
    expect(formSchemaSchema.safeParse(result.schema).success).toBe(true)
  })

  it('throws on non-JSON model output', async () => {
    mockChat.mockResolvedValue({
      text: 'sorry, here is some prose instead of json',
      usage: { model: 't', inputTokens: 1, outputTokens: 1 },
    } as never)
    await expect(
      generateFormSchema({ description: 'describe a form please' }),
    ).rejects.toThrow(/non-JSON/)
  })
})
