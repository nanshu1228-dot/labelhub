import { describe, expect, it } from 'vitest'
import {
  applyTopicItemMergePatch,
  summarizeTopicPatchKeys,
} from './item-data-patch'

describe('applyTopicItemMergePatch', () => {
  it('merges nested objects without mutating the original topic data', () => {
    const original = {
      prompt: 'old',
      responseA: { modelName: 'a', content: 'A' },
      meta: { source: 'seed', batch: 1 },
    }

    const result = applyTopicItemMergePatch(original, {
      prompt: 'new',
      meta: { batch: 2, locale: 'zh-CN' },
    })

    expect(result).toEqual({
      prompt: 'new',
      responseA: { modelName: 'a', content: 'A' },
      meta: { source: 'seed', batch: 2, locale: 'zh-CN' },
    })
    expect(original.meta).toEqual({ source: 'seed', batch: 1 })
  })

  it('removes keys whose patch value is null', () => {
    const result = applyTopicItemMergePatch(
      { prompt: 'p', context: 'remove me', meta: { source: 'x' } },
      { context: null, meta: null },
    )

    expect(result).toEqual({ prompt: 'p' })
  })
})

describe('summarizeTopicPatchKeys', () => {
  it('returns deterministic top-level patch keys for audit payloads', () => {
    expect(summarizeTopicPatchKeys({ z: 1, a: 2 })).toEqual(['a', 'z'])
  })
})
