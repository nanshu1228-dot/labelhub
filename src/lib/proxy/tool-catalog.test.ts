import { describe, expect, it } from 'vitest'
import { extractToolCatalog } from './tool-catalog'

describe('extractToolCatalog (openai shape)', () => {
  it('returns [] for missing / non-array tools', () => {
    expect(extractToolCatalog(undefined, 'openai')).toEqual([])
    expect(extractToolCatalog(null, 'openai')).toEqual([])
    expect(extractToolCatalog('not an array', 'openai')).toEqual([])
    expect(extractToolCatalog({}, 'openai')).toEqual([])
  })

  it('extracts a single function tool with full schema', () => {
    const out = extractToolCatalog(
      [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather for a city.',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        },
      ],
      'openai',
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      kind: 'function',
      name: 'get_weather',
      description: 'Get the current weather for a city.',
    })
    expect((out[0].parameters as { properties: object }).properties).toHaveProperty(
      'city',
    )
  })

  it('preserves order across multiple tools', () => {
    const out = extractToolCatalog(
      [
        { type: 'function', function: { name: 'a' } },
        { type: 'function', function: { name: 'b' } },
        { type: 'function', function: { name: 'c' } },
      ],
      'openai',
    )
    expect(out.map((t) => t.name)).toEqual(['a', 'b', 'c'])
  })

  it('skips malformed entries but keeps the rest', () => {
    const out = extractToolCatalog(
      [
        { type: 'function', function: { name: 'good' } },
        null,
        'not an object',
        { type: 'function' }, // missing function block
        { type: 'function', function: { name: '' } }, // empty name
        { type: 'function', function: { name: 'also-good' } },
      ],
      'openai',
    )
    expect(out.map((t) => t.name)).toEqual(['good', 'also-good'])
  })

  it('captures non-function tool kinds (code_interpreter, retrieval)', () => {
    const out = extractToolCatalog(
      [{ type: 'code_interpreter' }, { type: 'web_search' }],
      'openai',
    )
    expect(out).toEqual([
      { kind: 'code_interpreter', name: 'code_interpreter' },
      { kind: 'web_search', name: 'web_search' },
    ])
  })
})

describe('extractToolCatalog (anthropic shape)', () => {
  it('extracts a custom tool with input_schema', () => {
    const out = extractToolCatalog(
      [
        {
          name: 'get_weather',
          description: 'Get city weather.',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      ],
      'anthropic',
    )
    expect(out).toEqual([
      {
        kind: 'custom',
        name: 'get_weather',
        description: 'Get city weather.',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
        },
      },
    ])
  })

  it('honors explicit type (computer_use, bash_20250124, etc.)', () => {
    const out = extractToolCatalog(
      [
        { type: 'computer_20241022', name: 'computer' },
        { type: 'bash_20241022', name: 'bash' },
      ],
      'anthropic',
    )
    expect(out.map((t) => t.kind)).toEqual(['computer_20241022', 'bash_20241022'])
  })

  it('skips entries with no name (Anthropic requires it)', () => {
    const out = extractToolCatalog(
      [
        { name: 'ok' },
        { description: 'no name' },
        { name: '' },
        { name: 'ok2' },
      ],
      'anthropic',
    )
    expect(out.map((t) => t.name)).toEqual(['ok', 'ok2'])
  })
})
