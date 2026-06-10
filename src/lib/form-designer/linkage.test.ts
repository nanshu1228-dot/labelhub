import { describe, expect, it } from 'vitest'
import {
  evaluatePredicate,
  filterVisibleFields,
  isFieldRequired,
  isFieldVisible,
  type FormValues,
} from './linkage'
import { FORM_SCHEMA_VERSION, type FieldNode, type LinkagePredicate } from './schema'

/**
 * Linkage evaluator unit tests — Finals P1 D5.
 *
 * Covers each operator in {@link LinkagePredicate}, plus the wrap
 * helpers (isFieldVisible / isFieldRequired) and the recursive
 * filterVisibleFields traversal. The numbers behind the gate: "form
 * with `{textarea required, select with options, textarea visible-when
 * select=='other'}` serializes, deserializes, validates per-field in
 * unit test" — `filterVisibleFields` is the runtime predicate.
 */

function field(id: string, overrides: Partial<FieldNode> = {}): FieldNode {
  return {
    id,
    kind: 'text',
    label: id,
    config: {},
    validation: [],
    ...overrides,
  } as FieldNode
}

describe('linkage evaluatePredicate — operators', () => {
  it('eq: strict equality on primitives', () => {
    expect(evaluatePredicate({ fieldId: 'a', op: 'eq', value: 'x' }, { a: 'x' })).toBe(true)
    expect(evaluatePredicate({ fieldId: 'a', op: 'eq', value: 'x' }, { a: 'y' })).toBe(false)
    expect(evaluatePredicate({ fieldId: 'a', op: 'eq', value: 1 }, { a: 1 })).toBe(true)
    expect(evaluatePredicate({ fieldId: 'a', op: 'eq', value: 1 }, { a: '1' })).toBe(false)
  })

  it('eq: deep-equal on arrays + objects', () => {
    expect(
      evaluatePredicate(
        { fieldId: 'a', op: 'eq', value: { x: [1, 2] } },
        { a: { x: [1, 2] } },
      ),
    ).toBe(true)
    expect(
      evaluatePredicate(
        { fieldId: 'a', op: 'eq', value: [1, 2, 3] },
        { a: [1, 2, 3] },
      ),
    ).toBe(true)
    expect(
      evaluatePredicate(
        { fieldId: 'a', op: 'eq', value: [1, 2] },
        { a: [1, 2, 3] },
      ),
    ).toBe(false)
  })

  it('neq: inverse of eq', () => {
    expect(evaluatePredicate({ fieldId: 'a', op: 'neq', value: 'x' }, { a: 'y' })).toBe(true)
    expect(evaluatePredicate({ fieldId: 'a', op: 'neq', value: 'x' }, { a: 'x' })).toBe(false)
  })

  it('in: LHS in RHS array', () => {
    expect(
      evaluatePredicate({ fieldId: 'a', op: 'in', value: ['x', 'y'] }, { a: 'x' }),
    ).toBe(true)
    expect(
      evaluatePredicate({ fieldId: 'a', op: 'in', value: ['x', 'y'] }, { a: 'z' }),
    ).toBe(false)
  })

  it('in: RHS must be an array (otherwise false)', () => {
    expect(
      evaluatePredicate({ fieldId: 'a', op: 'in', value: 'x' as unknown }, { a: 'x' }),
    ).toBe(false)
  })

  it('notIn: inverse of in', () => {
    expect(
      evaluatePredicate({ fieldId: 'a', op: 'notIn', value: ['x', 'y'] }, { a: 'z' }),
    ).toBe(true)
    expect(
      evaluatePredicate({ fieldId: 'a', op: 'notIn', value: ['x', 'y'] }, { a: 'x' }),
    ).toBe(false)
  })

  it('truthy / falsy: Boolean coercion', () => {
    expect(evaluatePredicate({ fieldId: 'a', op: 'truthy' }, { a: 'hi' })).toBe(true)
    expect(evaluatePredicate({ fieldId: 'a', op: 'truthy' }, { a: 0 })).toBe(false)
    expect(evaluatePredicate({ fieldId: 'a', op: 'truthy' }, { a: '' })).toBe(false)
    expect(evaluatePredicate({ fieldId: 'a', op: 'truthy' }, { a: null })).toBe(false)
    expect(evaluatePredicate({ fieldId: 'a', op: 'falsy' }, { a: 0 })).toBe(true)
    expect(evaluatePredicate({ fieldId: 'a', op: 'falsy' }, { a: 'hi' })).toBe(false)
  })

  it('gte / lte: numeric only', () => {
    expect(evaluatePredicate({ fieldId: 'a', op: 'gte', value: 5 }, { a: 5 })).toBe(true)
    expect(evaluatePredicate({ fieldId: 'a', op: 'gte', value: 5 }, { a: 6 })).toBe(true)
    expect(evaluatePredicate({ fieldId: 'a', op: 'gte', value: 5 }, { a: 4 })).toBe(false)
    expect(evaluatePredicate({ fieldId: 'a', op: 'lte', value: 5 }, { a: 5 })).toBe(true)
    expect(evaluatePredicate({ fieldId: 'a', op: 'lte', value: 5 }, { a: 4 })).toBe(true)
    expect(evaluatePredicate({ fieldId: 'a', op: 'lte', value: 5 }, { a: 6 })).toBe(false)
  })

  it('gte / lte: non-numbers fail closed (false)', () => {
    expect(
      evaluatePredicate({ fieldId: 'a', op: 'gte', value: 5 }, { a: 'six' }),
    ).toBe(false)
    expect(
      evaluatePredicate({ fieldId: 'a', op: 'lte', value: 5 as unknown }, { a: 'four' }),
    ).toBe(false)
  })

  it('missing field id returns undefined LHS — eq fails, neq passes', () => {
    expect(evaluatePredicate({ fieldId: 'absent', op: 'eq', value: 'x' }, {})).toBe(false)
    expect(evaluatePredicate({ fieldId: 'absent', op: 'neq', value: 'x' }, {})).toBe(true)
  })
})

describe('linkage isFieldVisible / isFieldRequired', () => {
  const visibleWhen: LinkagePredicate = { fieldId: 'cat', op: 'eq', value: 'other' }
  const target = field('details', {
    kind: 'textarea',
    visibleWhen,
    validation: [{ kind: 'required' }],
  })

  it('field with no visibleWhen is always visible', () => {
    const noLinkage = field('plain', { kind: 'text' })
    expect(isFieldVisible(noLinkage, {})).toBe(true)
  })

  it('visibility flips on predicate satisfaction', () => {
    expect(isFieldVisible(target, { cat: 'other' })).toBe(true)
    expect(isFieldVisible(target, { cat: 'bug' })).toBe(false)
    expect(isFieldVisible(target, {})).toBe(false)
  })

  it('requiredWhen overrides static required when present', () => {
    const f = field('details', {
      requiredWhen: visibleWhen,
      validation: [],
    })
    expect(isFieldRequired(f, { cat: 'other' })).toBe(true)
    expect(isFieldRequired(f, { cat: 'bug' })).toBe(false)
  })

  it('static required holds when no requiredWhen', () => {
    const f = field('details', { validation: [{ kind: 'required' }] })
    expect(isFieldRequired(f, {})).toBe(true)
  })

  it('hidden field is never required', () => {
    expect(isFieldRequired(target, { cat: 'bug' })).toBe(false)
  })
})

describe('linkage filterVisibleFields (recursive)', () => {
  it('removes hidden fields at the top level', () => {
    const fields: FieldNode[] = [
      field('a', { kind: 'text' }),
      field('b', {
        kind: 'text',
        visibleWhen: { fieldId: 'flag', op: 'truthy' },
      }),
      field('c', { kind: 'text' }),
    ]
    const visible = filterVisibleFields(fields, { flag: false })
    expect(visible.map((f) => f.id)).toEqual(['a', 'c'])
  })

  it('recurses into container children', () => {
    const fields: FieldNode[] = [
      field('grp', {
        kind: 'group',
        children: [
          field('x', { kind: 'text' }),
          field('y', {
            kind: 'text',
            visibleWhen: { fieldId: 'show_y', op: 'truthy' },
          }),
        ],
      }),
    ]
    const hidden = filterVisibleFields(fields, { show_y: false })
    expect(hidden[0].children?.map((c) => c.id)).toEqual(['x'])
    const shown = filterVisibleFields(fields, { show_y: true })
    expect(shown[0].children?.map((c) => c.id)).toEqual(['x', 'y'])
  })

  it('hidden parent transitively hides its children (parent dropped)', () => {
    const fields: FieldNode[] = [
      field('grp', {
        kind: 'group',
        visibleWhen: { fieldId: 'show_grp', op: 'truthy' },
        children: [field('x', { kind: 'text' })],
      }),
    ]
    expect(filterVisibleFields(fields, { show_grp: false })).toEqual([])
  })

  it('preserves field identity (no mutation) on the input array', () => {
    const fields: FieldNode[] = [
      field('a', { kind: 'text' }),
      field('b', {
        kind: 'text',
        visibleWhen: { fieldId: 'q', op: 'eq', value: 1 },
      }),
    ]
    const snapshot = JSON.stringify(fields)
    filterVisibleFields(fields, { q: 2 })
    expect(JSON.stringify(fields)).toBe(snapshot)
  })

  it('integrates with the D4 gate form — textarea hidden when select != other', () => {
    const fields: FieldNode[] = [
      field('cat', {
        kind: 'single-select',
        config: {
          options: [
            { value: 'a', label: 'A' },
            { value: 'other', label: 'Other' },
          ],
        },
      }),
      field('details', {
        kind: 'textarea',
        visibleWhen: { fieldId: 'cat', op: 'eq', value: 'other' },
      }),
    ]
    const hidden: FormValues = { cat: 'a' }
    const shown: FormValues = { cat: 'other' }
    expect(filterVisibleFields(fields, hidden).map((f) => f.id)).toEqual(['cat'])
    expect(filterVisibleFields(fields, shown).map((f) => f.id)).toEqual(['cat', 'details'])
  })

  it('FormSchema version is forward-compatible with linkage (compile-time)', () => {
    // Sanity that imports compose — D6 Renderer will use both.
    expect(FORM_SCHEMA_VERSION).toBe(1)
  })
})
