import { describe, expect, it } from 'vitest'
import { inspectTrajectoryEncoding, looksMojibake } from './encoding-qc'

describe('looksMojibake', () => {
  it('returns false for clean ASCII', () => {
    expect(looksMojibake('Hello, world!')).toBe(false)
  })

  it('returns false for clean Chinese / Japanese', () => {
    expect(looksMojibake('用一句话告诉我什么是标注平台。')).toBe(false)
    expect(looksMojibake('東京の天気を教えてください')).toBe(false)
  })

  it('returns false for emoji-heavy text', () => {
    expect(looksMojibake('hello 👋 world 🌍 emoji 🎉')).toBe(false)
  })

  it('flags strings containing the replacement character', () => {
    expect(looksMojibake('hello � world')).toBe(true)
  })

  it('flags GBK-as-UTF-8 mojibake (the curl-on-Windows signature)', () => {
    // Bytes for "用一句话" in GBK decoded as UTF-8 = mostly U+FFFD chunks.
    // Approximate the pattern:
    const garbled = '��诶���'
    expect(looksMojibake(garbled)).toBe(true)
  })

  it('returns false for short strings (insufficient signal)', () => {
    expect(looksMojibake('hi')).toBe(false)
    expect(looksMojibake('')).toBe(false)
    expect(looksMojibake(null)).toBe(false)
  })
})

describe('inspectTrajectoryEncoding', () => {
  it('flags which fields look broken', () => {
    const r = inspectTrajectoryEncoding({
      rootPrompt: '���h�仰',
      finalResponse: 'This is a perfectly normal response.',
      systemPrompt: null,
    })
    expect(r.suspect).toBe(true)
    expect(r.fields).toEqual(['rootPrompt'])
  })

  it('reports no flags when everything is clean', () => {
    const r = inspectTrajectoryEncoding({
      rootPrompt: '上海今天天气怎么样？',
      finalResponse: '今天上海多云,气温 18°C。',
      systemPrompt: '你是一个助手。',
    })
    expect(r.suspect).toBe(false)
    expect(r.fields).toEqual([])
  })
})
