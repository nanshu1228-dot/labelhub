import { describe, expect, it } from 'vitest'
import { AppError } from '@/lib/errors'
import { parseFieldMappingParam } from './mapping-param'

describe('parseFieldMappingParam', () => {
  it('returns undefined when the query param is absent', () => {
    expect(parseFieldMappingParam(null)).toBeUndefined()
  })

  it('parses source/target mappings and trims names', () => {
    expect(
      parseFieldMappingParam(
        JSON.stringify([
          {
            source: ' payload.answer ',
            target: ' answer ',
            transform: 'json_stringify',
          },
        ]),
      ),
    ).toEqual([
      {
        source: 'payload.answer',
        target: 'answer',
        transform: 'json_stringify',
      },
    ])
  })

  it('rejects malformed JSON with an AppError', () => {
    expect(() => parseFieldMappingParam('{')).toThrow(AppError)
  })

  it('rejects invalid transform values', () => {
    expect(() =>
      parseFieldMappingParam(
        JSON.stringify([
          { source: 'payload', target: 'payload', transform: 'upper' },
        ]),
      ),
    ).toThrow(AppError)
  })

  it('caps mapping length', () => {
    const raw = JSON.stringify(
      Array.from({ length: 51 }, (_, i) => ({
        source: `field${i}`,
        target: `field${i}`,
      })),
    )
    expect(() => parseFieldMappingParam(raw)).toThrow(AppError)
  })
})
