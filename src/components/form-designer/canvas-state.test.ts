import { describe, expect, it } from 'vitest'
import {
  appendChildTo,
  deleteField,
  locateField,
  makeFieldFromKind,
  patchField,
  reorderSiblings,
  setChildrenAt,
  siblingsOf,
} from './canvas-state'
import {
  EMPTY_FORM,
  FORM_SCHEMA_VERSION,
  type FieldNode,
  type FormSchema,
} from '@/lib/form-designer/schema'

/**
 * Tree-walking helper tests — Finals P1 D5.
 *
 * The Designer's nested DnD reorder + property-panel selection depend
 * on locateField / setChildrenAt / reorderSiblings / patchField /
 * deleteField. Bugs here corrupt the canvas atom — exercise every
 * branch.
 */

function mkText(id: string, label?: string): FieldNode {
  return {
    id,
    kind: 'text',
    label: label ?? id,
    config: { placeholder: '' },
    validation: [],
  }
}

function mkGroup(id: string, children: FieldNode[]): FieldNode {
  return {
    id,
    kind: 'group',
    label: id,
    config: {},
    validation: [],
    children,
  }
}

const schemaFlat: FormSchema = {
  version: FORM_SCHEMA_VERSION,
  fields: [mkText('a'), mkText('b'), mkText('c')],
}

const schemaNested: FormSchema = {
  version: FORM_SCHEMA_VERSION,
  fields: [
    mkText('top1'),
    mkGroup('grp', [mkText('child1'), mkText('child2')]),
    mkText('top2'),
  ],
}

describe('locateField', () => {
  it('finds a root-level field', () => {
    expect(locateField(schemaFlat.fields, 'b')).toEqual({
      parentId: null,
      index: 1,
    })
  })

  it('finds a nested child + reports its parent', () => {
    expect(locateField(schemaNested.fields, 'child2')).toEqual({
      parentId: 'grp',
      index: 1,
    })
  })

  it('returns undefined when the id is absent', () => {
    expect(locateField(schemaFlat.fields, 'missing')).toBeUndefined()
  })
})

describe('siblingsOf', () => {
  it('returns root-level fields for a top-level id', () => {
    expect(siblingsOf(schemaNested, 'top1').map((f) => f.id)).toEqual([
      'top1',
      'grp',
      'top2',
    ])
  })

  it('returns container children for a nested id', () => {
    expect(siblingsOf(schemaNested, 'child2').map((f) => f.id)).toEqual([
      'child1',
      'child2',
    ])
  })

  it('returns empty array for an absent id', () => {
    expect(siblingsOf(schemaNested, 'gone')).toEqual([])
  })
})

describe('setChildrenAt', () => {
  it('replaces the root fields array when parentId is null', () => {
    const next = setChildrenAt(schemaFlat, null, [mkText('z')])
    expect(next.fields).toHaveLength(1)
    expect(next.fields[0].id).toBe('z')
  })

  it('replaces a container.children at depth', () => {
    const next = setChildrenAt(schemaNested, 'grp', [mkText('only')])
    const grp = next.fields.find((f) => f.id === 'grp')!
    expect(grp.children?.map((c) => c.id)).toEqual(['only'])
    // unrelated siblings preserved
    expect(next.fields[0].id).toBe('top1')
    expect(next.fields[2].id).toBe('top2')
  })

  it('does not mutate the input schema', () => {
    const snapshot = JSON.stringify(schemaNested)
    setChildrenAt(schemaNested, 'grp', [mkText('only')])
    expect(JSON.stringify(schemaNested)).toBe(snapshot)
  })
})

describe('reorderSiblings', () => {
  it('reorders two root-level fields', () => {
    const next = reorderSiblings(schemaFlat, 'a', 'c')
    expect(next.fields.map((f) => f.id)).toEqual(['b', 'c', 'a'])
  })

  it('reorders two children inside the same container', () => {
    const next = reorderSiblings(schemaNested, 'child1', 'child2')
    const grp = next.fields.find((f) => f.id === 'grp')!
    expect(grp.children?.map((c) => c.id)).toEqual(['child2', 'child1'])
  })

  it('ignores active === over (no-op)', () => {
    const next = reorderSiblings(schemaFlat, 'a', 'a')
    expect(next).toBe(schemaFlat)
  })

  it('ignores cross-container drag (different parents)', () => {
    const next = reorderSiblings(schemaNested, 'top1', 'child1')
    expect(next).toBe(schemaNested)
  })

  it('ignores moves where either id is missing', () => {
    const next = reorderSiblings(schemaFlat, 'a', 'missing')
    expect(next).toBe(schemaFlat)
  })
})

describe('patchField', () => {
  it('replaces a root-level field', () => {
    const next = patchField(schemaFlat, mkText('b', 'B prime'))
    expect(next.fields.find((f) => f.id === 'b')?.label).toBe('B prime')
  })

  it('replaces a nested child', () => {
    const next = patchField(schemaNested, mkText('child2', 'child two'))
    const grp = next.fields.find((f) => f.id === 'grp')!
    expect(grp.children?.find((c) => c.id === 'child2')?.label).toBe('child two')
  })

  it('returns equivalent shape when the id is absent', () => {
    const next = patchField(schemaFlat, mkText('zzz'))
    expect(next.fields.map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('deleteField', () => {
  it('removes a root-level field', () => {
    const next = deleteField(schemaFlat, 'b')
    expect(next.fields.map((f) => f.id)).toEqual(['a', 'c'])
  })

  it('removes a nested child', () => {
    const next = deleteField(schemaNested, 'child1')
    const grp = next.fields.find((f) => f.id === 'grp')!
    expect(grp.children?.map((c) => c.id)).toEqual(['child2'])
  })

  it('removes a container with all of its children', () => {
    const next = deleteField(schemaNested, 'grp')
    expect(next.fields.map((f) => f.id)).toEqual(['top1', 'top2'])
  })
})

describe('appendChildTo', () => {
  it('appends to root when parentId is null', () => {
    const next = appendChildTo(schemaFlat, null, mkText('d'))
    expect(next.fields.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('appends to a container.children when parentId matches', () => {
    const next = appendChildTo(schemaNested, 'grp', mkText('child3'))
    const grp = next.fields.find((f) => f.id === 'grp')!
    expect(grp.children?.map((c) => c.id)).toEqual([
      'child1',
      'child2',
      'child3',
    ])
  })

  it('returns the schema unchanged when parentId does not exist', () => {
    const next = appendChildTo(schemaFlat, 'no-such', mkText('zzz'))
    expect(next).toBe(schemaFlat)
  })
})

describe('makeFieldFromKind — container defaults', () => {
  it('seeds an empty children[] for group', () => {
    const node = makeFieldFromKind('group', { columns: 1 }, 'Group')
    expect(node.children).toEqual([])
  })

  it('seeds tab-layout with a single starter tab group', () => {
    const node = makeFieldFromKind('tab-layout', {}, 'Tabs')
    expect(node.children).toHaveLength(1)
    expect(node.children?.[0].kind).toBe('group')
    expect(node.children?.[0].label).toBe('Tab 1')
  })

  it('leaves children undefined for non-container kinds', () => {
    const node = makeFieldFromKind('text', {}, 'Text')
    expect(node.children).toBeUndefined()
  })

  it('does not share defaultConfig references between two drops', () => {
    const a = makeFieldFromKind('single-select', {
      options: [{ value: 'a', label: 'A' }],
    }, 'A')
    const b = makeFieldFromKind('single-select', {
      options: [{ value: 'a', label: 'A' }],
    }, 'B')
    expect(a.config).not.toBe(b.config)
    expect((a.config as { options: unknown }).options).not.toBe(
      (b.config as { options: unknown }).options,
    )
  })
})

describe('schema starter values', () => {
  it('EMPTY_FORM is reusable across tests (not mutated)', () => {
    const a = JSON.stringify(EMPTY_FORM)
    appendChildTo(EMPTY_FORM, null, mkText('x'))
    expect(JSON.stringify(EMPTY_FORM)).toBe(a)
  })
})
