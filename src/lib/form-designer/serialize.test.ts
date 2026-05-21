import { describe, expect, it } from 'vitest'
import {
  EMPTY_FORM,
  FORM_SCHEMA_VERSION,
  type FieldNode,
  type FormSchema,
} from './schema'
import {
  fromJsonSchema,
  roundTrip,
  toJsonSchema,
  type JSONSchemaForm,
} from './serialize'

/**
 * Round-trip tests for the FormSchema ↔ JSON Schema (draft-07) serializer
 * (Finals P1 D4). The D4 gate says: build a 5-field form → serialize →
 * deserialize → byte-identical canvas state. Anything that breaks
 * round-trip breaks the Designer's storage contract.
 *
 * Property-style coverage: one test per material's canonical default,
 * plus a multi-field composite, plus the edge cases the Renderer leans
 * on (linkage, required, regex, container nesting).
 */

function mkField(id: string, overrides: Partial<FieldNode> & Pick<FieldNode, 'kind'>): FieldNode {
  return {
    id,
    label: `Field ${id}`,
    config: {},
    validation: [],
    ...overrides,
  }
}

function expectRoundTrip(schema: FormSchema): void {
  const doc = toJsonSchema(schema)
  // doc must be JSON-safe (no functions, no undefined values surviving).
  expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)
  expect(doc.$schema).toBe('http://json-schema.org/draft-07/schema#')
  expect(doc['x-labelhub-version']).toBe(FORM_SCHEMA_VERSION)
  const back = fromJsonSchema(doc)
  expect(back).toEqual(schema)
}

describe('FormSchema → JSON Schema → FormSchema (round-trip)', () => {
  it('round-trips an empty form', () => {
    expectRoundTrip(EMPTY_FORM)
  })

  it('round-trips a text field with maxLength + autocomplete', () => {
    expectRoundTrip({
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('f1', {
          kind: 'text',
          label: 'Name',
          config: { placeholder: 'Jane Doe', maxLength: 80, autocomplete: 'off' },
          validation: [],
        }),
      ],
    })
  })

  it('round-trips a textarea field with required + min/max-length', () => {
    expectRoundTrip({
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('f1', {
          kind: 'textarea',
          label: 'Reasoning',
          helperText: 'Explain your answer briefly.',
          config: { placeholder: '', maxLength: 4000, rows: 6 },
          validation: [
            { kind: 'required' },
            { kind: 'min-length', value: 10 },
            { kind: 'max-length', value: 4000 },
          ],
        }),
      ],
    })
  })

  it('round-trips a single-select with enum lifted from options[]', () => {
    const schema: FormSchema = {
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('cat', {
          kind: 'single-select',
          label: 'Category',
          config: {
            options: [
              { value: 'bug', label: 'Bug' },
              { value: 'feature', label: 'Feature' },
              { value: 'other', label: 'Other' },
            ],
            layout: 'vertical',
          },
          validation: [{ kind: 'required' }],
        }),
      ],
    }
    const doc = toJsonSchema(schema)
    // enum should be lifted onto the field subschema.
    expect(doc.properties.cat.enum).toEqual(['bug', 'feature', 'other'])
    // and the parent's `required` array should list the field.
    expect(doc.required).toEqual(['cat'])
    expectRoundTrip(schema)
  })

  it('round-trips a multi-select with items.enum + min/max items', () => {
    const schema: FormSchema = {
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('tags', {
          kind: 'multi-select',
          label: 'Tags',
          config: {
            options: [
              { value: 't1', label: 'Tag 1' },
              { value: 't2', label: 'Tag 2' },
              { value: 't3', label: 'Tag 3' },
            ],
            minSelected: 1,
            maxSelected: 2,
          },
          validation: [],
        }),
      ],
    }
    const doc = toJsonSchema(schema)
    expect(doc.properties.tags.type).toBe('array')
    expect(doc.properties.tags.items).toEqual({ type: 'string', enum: ['t1', 't2', 't3'] })
    expect(doc.properties.tags.minItems).toBe(1)
    expect(doc.properties.tags.maxItems).toBe(2)
    expect(doc.properties.tags.uniqueItems).toBe(true)
    expectRoundTrip(schema)
  })

  it('round-trips a rich-text field with toolbar + length bounds', () => {
    expectRoundTrip({
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('body', {
          kind: 'rich-text',
          label: 'Body',
          config: {
            placeholder: 'Type here…',
            minLength: 1,
            maxLength: 8000,
            toolbar: ['bold', 'italic', 'link', 'list'],
          },
          validation: [{ kind: 'required' }],
        }),
      ],
    })
  })

  it('round-trips a file-upload field with accept + size + count caps', () => {
    const schema: FormSchema = {
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('avatar', {
          kind: 'file-upload',
          label: 'Avatar',
          config: {
            accept: ['image/*'],
            maxSizeMb: 4,
            maxFiles: 3,
          },
          validation: [],
        }),
      ],
    }
    const doc = toJsonSchema(schema)
    expect(doc.properties.avatar.type).toBe('array')
    expect(doc.properties.avatar.maxItems).toBe(3)
    expect(doc.properties.avatar.items).toEqual({ type: 'string' })
    expectRoundTrip(schema)
  })

  it('round-trips a json-editor field with a nested jsonSchema config', () => {
    expectRoundTrip({
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('payload', {
          kind: 'json-editor',
          label: 'Custom payload',
          config: {
            formatOnBlur: true,
            jsonSchema: {
              type: 'object',
              properties: { foo: { type: 'string' } },
              required: ['foo'],
            },
          },
          validation: [],
        }),
      ],
    })
  })

  it('round-trips an llm-trigger field with promptTemplate + tier', () => {
    expectRoundTrip({
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('assist', {
          kind: 'llm-trigger',
          label: 'AI suggest answer',
          config: {
            buttonLabel: 'Suggest',
            promptTemplate: 'Suggest an answer for the labeled field.',
            targetFieldId: 'reasoning',
            tier: 'fast',
          },
          validation: [],
        }),
      ],
    })
  })

  it('round-trips a show-item field with sourcePath + renderAs', () => {
    expectRoundTrip({
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('show', {
          kind: 'show-item',
          label: 'Question',
          config: { sourcePath: 'prompt', renderAs: 'markdown' },
          validation: [],
        }),
      ],
    })
  })

  it('round-trips a regex validation rule via the pattern keyword', () => {
    const schema: FormSchema = {
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('email', {
          kind: 'text',
          label: 'Email',
          config: { placeholder: 'you@example.com' },
          validation: [
            { kind: 'required' },
            { kind: 'regex', pattern: '^[^@]+@[^@]+\\.[^@]+$' },
          ],
        }),
      ],
    }
    const doc = toJsonSchema(schema)
    expect(doc.properties.email.pattern).toBe('^[^@]+@[^@]+\\.[^@]+$')
    expect(doc.required).toEqual(['email'])
    expectRoundTrip(schema)
  })

  it('round-trips a numeric min/max rule via minimum/maximum', () => {
    const schema: FormSchema = {
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('score', {
          kind: 'text',
          label: 'Score',
          config: { placeholder: '0-100' },
          validation: [
            { kind: 'min', value: 0 },
            { kind: 'max', value: 100 },
          ],
        }),
      ],
    }
    const doc = toJsonSchema(schema)
    expect(doc.properties.score.minimum).toBe(0)
    expect(doc.properties.score.maximum).toBe(100)
    expectRoundTrip(schema)
  })

  it('round-trips visibleWhen + requiredWhen linkage predicates', () => {
    expectRoundTrip({
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('category', {
          kind: 'single-select',
          label: 'Category',
          config: {
            options: [
              { value: 'a', label: 'A' },
              { value: 'other', label: 'Other' },
            ],
            layout: 'vertical',
          },
          validation: [],
        }),
        mkField('details', {
          kind: 'textarea',
          label: 'Details',
          config: { placeholder: '' },
          validation: [],
          visibleWhen: { fieldId: 'category', op: 'eq', value: 'other' },
          requiredWhen: { fieldId: 'category', op: 'eq', value: 'other' },
        }),
      ],
    })
  })

  it('round-trips a group container with two children + nested required', () => {
    const schema: FormSchema = {
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('addr', {
          kind: 'group',
          label: 'Address',
          config: {},
          validation: [],
          children: [
            mkField('street', {
              kind: 'text',
              label: 'Street',
              config: {},
              validation: [{ kind: 'required' }],
            }),
            mkField('city', {
              kind: 'text',
              label: 'City',
              config: {},
              validation: [],
            }),
          ],
        }),
      ],
    }
    const doc = toJsonSchema(schema)
    expect(doc.properties.addr.type).toBe('object')
    expect(doc.properties.addr.properties).toBeDefined()
    expect(doc.properties.addr.required).toEqual(['street'])
    expect(doc.properties.addr['x-labelhub-children-order']).toEqual(['street', 'city'])
    expectRoundTrip(schema)
  })

  it('round-trips a tab-layout with two tab groups', () => {
    const schema: FormSchema = {
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('layout', {
          kind: 'tab-layout',
          label: 'Tabs',
          config: { tabs: [{ id: 'tab1', label: 'A' }, { id: 'tab2', label: 'B' }] },
          validation: [],
          children: [
            mkField('tab1', {
              kind: 'group',
              label: 'Tab A',
              config: {},
              validation: [],
              children: [
                mkField('a1', { kind: 'text', label: 'A1', config: {}, validation: [] }),
              ],
            }),
            mkField('tab2', {
              kind: 'group',
              label: 'Tab B',
              config: {},
              validation: [],
              children: [
                mkField('b1', { kind: 'textarea', label: 'B1', config: {}, validation: [] }),
              ],
            }),
          ],
        }),
      ],
    }
    expectRoundTrip(schema)
  })

  it('round-trips the D4 gate: 5-field form, mixed kinds, byte-identical', () => {
    expectRoundTrip({
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('show', {
          kind: 'show-item',
          label: 'Prompt',
          config: { sourcePath: 'prompt', renderAs: 'markdown' },
          validation: [],
        }),
        mkField('category', {
          kind: 'single-select',
          label: 'Category',
          config: {
            options: [
              { value: 'bug', label: 'Bug' },
              { value: 'feature', label: 'Feature' },
              { value: 'other', label: 'Other' },
            ],
            layout: 'vertical',
          },
          validation: [{ kind: 'required' }],
        }),
        mkField('details', {
          kind: 'textarea',
          label: 'Details',
          config: { placeholder: 'Anything else?', maxLength: 4000, rows: 4 },
          validation: [{ kind: 'max-length', value: 4000 }],
          visibleWhen: { fieldId: 'category', op: 'eq', value: 'other' },
          requiredWhen: { fieldId: 'category', op: 'eq', value: 'other' },
        }),
        mkField('attachments', {
          kind: 'file-upload',
          label: 'Attachments',
          config: { accept: ['image/*', 'application/pdf'], maxSizeMb: 8, maxFiles: 3 },
          validation: [],
        }),
        mkField('assist', {
          kind: 'llm-trigger',
          label: 'AI suggest',
          config: {
            buttonLabel: 'Ask Claude',
            promptTemplate: 'Suggest a short answer.',
            targetFieldId: 'details',
            tier: 'fast',
          },
          validation: [],
        }),
      ],
    })
  })

  it('roundTrip helper returns the structurally identical FormSchema', () => {
    const schema: FormSchema = {
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('a', { kind: 'text', label: 'A', config: { placeholder: 'a' }, validation: [] }),
        mkField('b', { kind: 'text', label: 'B', config: { placeholder: 'b' }, validation: [] }),
      ],
    }
    expect(roundTrip(schema)).toEqual(schema)
  })
})

describe('FormSchema → JSON Schema (output shape)', () => {
  it('mirrors validation.required into the parent required[] (draft-07 idiom)', () => {
    const doc = toJsonSchema({
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('x', {
          kind: 'text',
          label: 'X',
          config: {},
          validation: [{ kind: 'required' }],
        }),
        mkField('y', {
          kind: 'text',
          label: 'Y',
          config: {},
          validation: [],
        }),
      ],
    })
    expect(doc.required).toEqual(['x'])
  })

  it('emits x-labelhub-order to preserve canvas ordering', () => {
    const doc = toJsonSchema({
      version: FORM_SCHEMA_VERSION,
      fields: [
        mkField('z', { kind: 'text', label: 'Z', config: {}, validation: [] }),
        mkField('a', { kind: 'text', label: 'A', config: {}, validation: [] }),
        mkField('m', { kind: 'text', label: 'M', config: {}, validation: [] }),
      ],
    })
    expect(doc['x-labelhub-order']).toEqual(['z', 'a', 'm'])
  })

  it('threads $id + title when provided via opts', () => {
    const doc = toJsonSchema(
      {
        version: FORM_SCHEMA_VERSION,
        fields: [
          mkField('one', { kind: 'text', label: 'One', config: {}, validation: [] }),
        ],
      },
      { id: 'https://example.com/forms/1.json', title: 'Form one' },
    )
    expect(doc.$id).toBe('https://example.com/forms/1.json')
    expect(doc.title).toBe('Form one')
  })

  it('throws on a malformed input FormSchema (Zod refusal)', () => {
    expect(() =>
      toJsonSchema({
        version: FORM_SCHEMA_VERSION,
        // @ts-expect-error — intentionally wrong shape
        fields: [{ id: 'x' /* missing kind, label, config */ }],
      }),
    ).toThrow()
  })

  it('rejects an unknown JSON Schema dialect on decode', () => {
    expect(() =>
      fromJsonSchema({
        $schema: 'http://json-schema.org/draft/2020-12/schema' as unknown as JSONSchemaForm['$schema'],
        type: 'object',
        'x-labelhub-version': FORM_SCHEMA_VERSION,
        properties: {},
        required: [],
        'x-labelhub-order': [],
      } as JSONSchemaForm),
    ).toThrow(/dialect/)
  })

  it('rejects a mismatched FormSchema version on decode', () => {
    expect(() =>
      fromJsonSchema({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        'x-labelhub-version': 99,
        properties: {},
        required: [],
        'x-labelhub-order': [],
      } as JSONSchemaForm),
    ).toThrow(/version/)
  })

  it('rejects a property missing the x-labelhub-kind extension', () => {
    expect(() =>
      fromJsonSchema({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        'x-labelhub-version': FORM_SCHEMA_VERSION,
        properties: {
          orphan: {
            type: 'string',
            // no x-labelhub-kind, no x-labelhub-id
          } as unknown as JSONSchemaForm['properties'][string],
        },
        required: [],
        'x-labelhub-order': ['orphan'],
      } as JSONSchemaForm),
    ).toThrow(/x-labelhub-kind/)
  })
})
