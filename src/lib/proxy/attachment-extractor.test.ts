import { describe, expect, it } from 'vitest'
import { extractAttachments } from './attachment-extractor'

/** Encode a string as base64 for fixture construction. */
function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64')
}

describe('extractAttachments', () => {
  it('returns [] for messages with only string content', () => {
    expect(
      extractAttachments([
        { content: 'hello' },
        { content: 'world' },
      ]),
    ).toEqual([])
  })

  it('detects an OpenAI image_url with data: scheme', () => {
    const data = `data:image/png;base64,${b64('fake-png-bytes')}`
    const out = extractAttachments([
      {
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: data } },
        ],
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('image')
    expect(out[0].source).toBe('base64-inline')
    expect(out[0].mediaType).toBe('image/png')
    expect(out[0].messageIndex).toBe(0)
    expect(out[0].blockIndex).toBe(1)
    // bytes should be ~ length of "fake-png-bytes" (14 chars when decoded)
    expect(out[0].bytes).toBe(14)
    expect(out[0].hashPrefix).toMatch(/^[0-9a-f]{16}$/)
  })

  it('detects an OpenAI image_url with https: scheme', () => {
    const out = extractAttachments([
      {
        content: [
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/photo.jpg' },
          },
        ],
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('url')
    expect(out[0].url).toBe('https://example.com/photo.jpg')
    expect(out[0].mediaType).toBeUndefined()
  })

  it('detects Anthropic-shaped image / document blocks', () => {
    const out = extractAttachments([
      {
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: b64('jpg-bytes'),
            },
          },
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: b64('pdf-bytes-here'),
            },
          },
          {
            type: 'image',
            source: {
              type: 'url',
              url: 'https://cdn.example.com/x.png',
              media_type: 'image/png',
            },
          },
        ],
      },
    ])
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({
      kind: 'image',
      source: 'base64-inline',
      mediaType: 'image/jpeg',
      bytes: 9,
    })
    expect(out[1]).toMatchObject({
      kind: 'document',
      source: 'base64-inline',
      mediaType: 'application/pdf',
    })
    expect(out[2]).toMatchObject({
      kind: 'image',
      source: 'url',
      url: 'https://cdn.example.com/x.png',
      mediaType: 'image/png',
    })
  })

  it('preserves messageIndex across multiple messages', () => {
    const data = `data:image/gif;base64,${b64('gif1')}`
    const out = extractAttachments([
      { content: 'hello' },
      {
        content: [
          { type: 'image_url', image_url: { url: data } },
        ],
      },
      { content: 'no attachments here' },
      {
        content: [
          { type: 'image_url', image_url: { url: data } },
        ],
      },
    ])
    expect(out.map((a) => a.messageIndex)).toEqual([1, 3])
  })

  it('detects audio (input_audio)', () => {
    const out = extractAttachments([
      {
        content: [
          {
            type: 'input_audio',
            input_audio: { data: b64('wav-bytes-here'), format: 'wav' },
          },
        ],
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('audio')
    expect(out[0].mediaType).toBe('audio/wav')
  })

  it('returns the same hashPrefix for identical content (content-addressable)', () => {
    const data = `data:image/png;base64,${b64('same-bytes')}`
    const out = extractAttachments([
      {
        content: [
          { type: 'image_url', image_url: { url: data } },
          { type: 'image_url', image_url: { url: data } },
        ],
      },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].hashPrefix).toBe(out[1].hashPrefix)
  })

  it('ignores unknown block types', () => {
    const out = extractAttachments([
      {
        content: [
          { type: 'text', text: 'normal' },
          { type: 'mysterious_future_block_type', payload: { x: 1 } },
        ],
      },
    ])
    expect(out).toEqual([])
  })
})
