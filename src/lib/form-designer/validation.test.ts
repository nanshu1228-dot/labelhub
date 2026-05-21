import { describe, expect, it } from 'vitest'
import {
  compileFieldValidator,
  compileFormValidator,
} from './validation'
import { FORM_SCHEMA_VERSION, type FieldNode } from './schema'

/**
 * Custom validation DSL → Zod compiler tests — Finals P1 D5.
 *
 * Each material's rule combinations compile to a Zod schema; we then
 * exercise success + failure inputs against the compiled validator.
 * Covers the matrix `kind × {required, min-length, max-length, regex,
 * min, max}` plus container nesting + non-payload kinds.
 */

function field(id: string, overrides: Partial<FieldNode> & Pick<FieldNode, 'kind'>): FieldNode {
  return {
    id,
    label: id,
    config: {},
    validation: [],
    ...overrides,
  }
}

describe('compileFieldValidator — text fields', () => {
  it('text required: empty string fails, content passes', () => {
    const v = compileFieldValidator(
      field('f', { kind: 'text', validation: [{ kind: 'required' }] }),
    )
    expect(v.safeParse('').success).toBe(false)
    expect(v.safeParse('hello').success).toBe(true)
    expect(v.safeParse(null).success).toBe(false)
    expect(v.safeParse(undefined).success).toBe(false)
  })

  it('text optional: empty string + undefined + null pass', () => {
    const v = compileFieldValidator(field('f', { kind: 'text', validation: [] }))
    expect(v.safeParse(undefined).success).toBe(true)
    expect(v.safeParse(null).success).toBe(true)
    expect(v.safeParse('').success).toBe(true)
    expect(v.safeParse('value').success).toBe(true)
  })

  it('text min/max-length boundaries', () => {
    const v = compileFieldValidator(
      field('f', {
        kind: 'text',
        validation: [
          { kind: 'required' },
          { kind: 'min-length', value: 3 },
          { kind: 'max-length', value: 5 },
        ],
      }),
    )
    expect(v.safeParse('ab').success).toBe(false)
    expect(v.safeParse('abc').success).toBe(true)
    expect(v.safeParse('abcde').success).toBe(true)
    expect(v.safeParse('abcdef').success).toBe(false)
  })

  it('text regex (email-ish) accepts / rejects accordingly', () => {
    const v = compileFieldValidator(
      field('f', {
        kind: 'text',
        validation: [
          { kind: 'required' },
          { kind: 'regex', pattern: '^[^@]+@[^@]+\\.[^@]+$' },
        ],
      }),
    )
    expect(v.safeParse('alice@example.com').success).toBe(true)
    expect(v.safeParse('not an email').success).toBe(false)
  })

  it('text min/max as numeric range (string-as-number coercion)', () => {
    const v = compileFieldValidator(
      field('f', {
        kind: 'text',
        validation: [
          { kind: 'required' },
          { kind: 'min', value: 0 },
          { kind: 'max', value: 100 },
        ],
      }),
    )
    expect(v.safeParse('50').success).toBe(true)
    expect(v.safeParse('100').success).toBe(true)
    expect(v.safeParse('101').success).toBe(false)
    expect(v.safeParse('-1').success).toBe(false)
    expect(v.safeParse('abc').success).toBe(false)
  })

  it('regex with a bad pattern fails closed', () => {
    const v = compileFieldValidator(
      field('f', {
        kind: 'text',
        validation: [
          { kind: 'required' },
          { kind: 'regex', pattern: '[unclosed' },
        ],
      }),
    )
    expect(v.safeParse('anything').success).toBe(false)
  })
})

describe('compileFieldValidator — select kinds', () => {
  it('single-select accepts an option value only', () => {
    const v = compileFieldValidator(
      field('f', {
        kind: 'single-select',
        config: {
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
        },
        validation: [{ kind: 'required' }],
      }),
    )
    expect(v.safeParse('a').success).toBe(true)
    expect(v.safeParse('b').success).toBe(true)
    expect(v.safeParse('c').success).toBe(false)
  })

  it('multi-select rejects entries outside the options', () => {
    const v = compileFieldValidator(
      field('f', {
        kind: 'multi-select',
        config: {
          options: [
            { value: 'x', label: 'X' },
            { value: 'y', label: 'Y' },
          ],
        },
        validation: [{ kind: 'min-length', value: 1 }],
      }),
    )
    expect(v.safeParse(['x']).success).toBe(true)
    expect(v.safeParse(['x', 'y']).success).toBe(true)
    expect(v.safeParse(['x', 'z']).success).toBe(false)
    expect(v.safeParse([]).success).toBe(false)
  })

  it('multi-select with max-length caps array size', () => {
    const v = compileFieldValidator(
      field('f', {
        kind: 'multi-select',
        config: {
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
            { value: 'c', label: 'C' },
          ],
        },
        validation: [
          { kind: 'required' },
          { kind: 'max-length', value: 2 },
        ],
      }),
    )
    expect(v.safeParse(['a', 'b']).success).toBe(true)
    expect(v.safeParse(['a', 'b', 'c']).success).toBe(false)
  })
})

describe('compileFieldValidator — file-upload + json-editor + non-payload', () => {
  it('file-upload optional: empty array passes when not required', () => {
    const v = compileFieldValidator(field('f', { kind: 'file-upload' }))
    expect(v.safeParse([]).success).toBe(true)
    expect(v.safeParse(['file_id_1']).success).toBe(true)
  })

  it('file-upload required: must have at least one entry', () => {
    const v = compileFieldValidator(
      field('f', { kind: 'file-upload', validation: [{ kind: 'required' }] }),
    )
    expect(v.safeParse([]).success).toBe(false)
    expect(v.safeParse(['x']).success).toBe(true)
  })

  it('json-editor accepts any JSON value', () => {
    const v = compileFieldValidator(field('f', { kind: 'json-editor' }))
    expect(v.safeParse({ foo: 1 }).success).toBe(true)
    expect(v.safeParse([1, 2, 3]).success).toBe(true)
    expect(v.safeParse('plain string').success).toBe(true)
    expect(v.safeParse(42).success).toBe(true)
  })

  it('show-item compiles to a never schema (no payload)', () => {
    const v = compileFieldValidator(field('f', { kind: 'show-item' }))
    expect(v.safeParse(undefined).success).toBe(true) // optional wrap
    expect(v.safeParse('anything').success).toBe(false)
  })

  it('llm-trigger compiles to a never schema (no payload)', () => {
    const v = compileFieldValidator(field('f', { kind: 'llm-trigger' }))
    expect(v.safeParse(undefined).success).toBe(true)
    expect(v.safeParse('anything').success).toBe(false)
  })
})

describe('compileFormValidator — full form composition', () => {
  it('compiles a 3-field form: required textarea + optional select + nested group', () => {
    const fields: FieldNode[] = [
      field('cat', {
        kind: 'single-select',
        config: {
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
        },
        validation: [],
      }),
      field('explain', {
        kind: 'textarea',
        validation: [
          { kind: 'required' },
          { kind: 'min-length', value: 5 },
        ],
      }),
      field('grp', {
        kind: 'group',
        children: [
          field('nested', {
            kind: 'text',
            validation: [{ kind: 'required' }],
          }),
        ],
      }),
    ]
    const v = compileFormValidator(fields)
    // OK
    expect(
      v.safeParse({
        cat: 'a',
        explain: 'enough characters',
        grp: { nested: 'ok' },
      }).success,
    ).toBe(true)
    // explain too short
    expect(
      v.safeParse({
        cat: 'a',
        explain: 'no',
        grp: { nested: 'ok' },
      }).success,
    ).toBe(false)
    // nested.required violated
    expect(
      v.safeParse({
        cat: 'a',
        explain: 'enough characters',
        grp: { nested: '' },
      }).success,
    ).toBe(false)
    // cat missing — optional, still passes
    expect(
      v.safeParse({
        explain: 'enough characters',
        grp: { nested: 'ok' },
      }).success,
    ).toBe(true)
  })

  it('skips non-payload widgets (show-item / llm-trigger) in the object schema', () => {
    const v = compileFormValidator([
      field('show', { kind: 'show-item' }),
      field('assist', { kind: 'llm-trigger' }),
      field('answer', {
        kind: 'text',
        validation: [{ kind: 'required' }],
      }),
    ])
    // Passing only `answer` validates — show/assist contribute no keys.
    expect(v.safeParse({ answer: 'hi' }).success).toBe(true)
  })

  it('tab-layout compiles as a nested record per tab (children are groups)', () => {
    const v = compileFormValidator([
      field('tabs', {
        kind: 'tab-layout',
        children: [
          field('tab_a', {
            kind: 'group',
            children: [
              field('q1', { kind: 'text', validation: [{ kind: 'required' }] }),
            ],
          }),
          field('tab_b', {
            kind: 'group',
            children: [
              field('q2', { kind: 'text', validation: [] }),
            ],
          }),
        ],
      }),
    ])
    expect(
      v.safeParse({
        tabs: { tab_a: { q1: 'value' }, tab_b: { q2: '' } },
      }).success,
    ).toBe(true)
    expect(
      v.safeParse({
        tabs: { tab_a: { q1: '' } },
      }).success,
    ).toBe(false)
  })
})
