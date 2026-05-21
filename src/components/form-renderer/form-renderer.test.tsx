import { describe, expect, it } from 'vitest'
import { resolveDottedPath } from './form-renderer'
import {
  FORM_SCHEMA_VERSION,
  formSchemaSchema,
  type FieldNode,
  type FormSchema,
} from '@/lib/form-designer/schema'
import { filterVisibleFields } from '@/lib/form-designer/linkage'
import { compileFormValidator } from '@/lib/form-designer/validation'
import { fromJsonSchema, toJsonSchema } from '@/lib/form-designer/serialize'

/**
 * Form Renderer unit tests — Finals P1 D6.
 *
 * The full Designer → save → Labeler → submit round trip is the D17
 * Playwright suite; D6 here verifies the runtime invariants the
 * Renderer depends on:
 *
 *   - resolveDottedPath: show-item's topic.itemData lookup
 *   - Schema validation: malformed input flips a banner instead of
 *     throwing, so the Labeler page never crashes on a bad row
 *   - filterVisibleFields + compileFormValidator + serializer all
 *     compose: build → serialize → deserialize → validate → result
 *     stays identical, which is what the Renderer asserts at mount
 *
 * Render-time DOM tests live in the Playwright suite (D17).
 */

describe('resolveDottedPath helper', () => {
  it('returns the source itself for an empty path', () => {
    expect(resolveDottedPath({ a: 1 }, '')).toEqual({ a: 1 })
  })

  it('walks a single segment', () => {
    expect(resolveDottedPath({ a: 'hi' }, 'a')).toBe('hi')
  })

  it('walks nested segments', () => {
    expect(resolveDottedPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42)
  })

  it('returns undefined when a segment is missing', () => {
    expect(resolveDottedPath({ a: { b: null } }, 'a.b.c')).toBeUndefined()
  })

  it('returns undefined when the source is not an object', () => {
    expect(resolveDottedPath('not an object', 'a')).toBeUndefined()
  })

  it('preserves an array shape through traversal', () => {
    expect(resolveDottedPath({ list: [1, 2, 3] }, 'list')).toEqual([1, 2, 3])
  })

  it('returns undefined when called on null/undefined source', () => {
    expect(resolveDottedPath(null, 'a')).toBeUndefined()
    expect(resolveDottedPath(undefined, 'a')).toBeUndefined()
  })
})

/**
 * End-to-end Designer ↔ Renderer invariant: a saved FormSchema
 * serializes to JSON Schema, deserializes back, and remains a valid
 * input for both the Renderer's mount-time guard and the validator.
 */
describe('Designer → Renderer round trip (no DOM)', () => {
  const gateForm: FormSchema = {
    version: FORM_SCHEMA_VERSION,
    fields: [
      {
        id: 'show',
        kind: 'show-item',
        label: 'Prompt',
        config: { sourcePath: 'prompt', renderAs: 'markdown' },
        validation: [],
      },
      {
        id: 'cat',
        kind: 'single-select',
        label: 'Category',
        config: {
          options: [
            { value: 'a', label: 'A' },
            { value: 'other', label: 'Other' },
          ],
          layout: 'vertical',
        },
        validation: [{ kind: 'required' }],
      },
      {
        id: 'details',
        kind: 'textarea',
        label: 'Details',
        config: { placeholder: '', maxLength: 4000, rows: 4 },
        validation: [{ kind: 'max-length', value: 4000 }],
        visibleWhen: { fieldId: 'cat', op: 'eq', value: 'other' },
        requiredWhen: { fieldId: 'cat', op: 'eq', value: 'other' },
      },
    ],
  }

  it('survives toJsonSchema → fromJsonSchema byte-identically', () => {
    const back = fromJsonSchema(toJsonSchema(gateForm))
    expect(back).toEqual(gateForm)
  })

  it('the Renderer-mount Zod guard accepts the round-tripped schema', () => {
    const back = fromJsonSchema(toJsonSchema(gateForm))
    expect(formSchemaSchema.safeParse(back).success).toBe(true)
  })

  it('the Renderer-mount guard rejects a malformed schema', () => {
    // Missing `version` and `fields`.
    const bad = { foo: 'bar' } as unknown as FormSchema
    expect(formSchemaSchema.safeParse(bad).success).toBe(false)
  })

  it('filterVisibleFields hides details when cat != other', () => {
    expect(
      filterVisibleFields(gateForm.fields, { cat: 'a' }).map((f) => f.id),
    ).toEqual(['show', 'cat'])
  })

  it('filterVisibleFields shows details when cat = other', () => {
    expect(
      filterVisibleFields(gateForm.fields, { cat: 'other' }).map((f) => f.id),
    ).toEqual(['show', 'cat', 'details'])
  })

  it('compileFormValidator accepts a full payload + rejects a missing required', () => {
    const v = compileFormValidator(gateForm.fields)
    expect(
      v.safeParse({
        cat: 'other',
        details: 'because other',
      }).success,
    ).toBe(true)
    // 'cat' is required at the parent — missing it fails.
    expect(
      v.safeParse({
        details: 'because other',
      }).success,
    ).toBe(false)
  })

  it('compileFormValidator skips show-item from the response schema', () => {
    const v = compileFormValidator(gateForm.fields)
    // show-item contributes no key — passing only cat satisfies the
    // schema (when cat ≠ other so details isn't required).
    expect(v.safeParse({ cat: 'a' }).success).toBe(true)
  })

  it('round-trip preserves a group container with nested required', () => {
    const schema: FormSchema = {
      version: FORM_SCHEMA_VERSION,
      fields: [
        {
          id: 'addr',
          kind: 'group',
          label: 'Address',
          config: { showTitle: true },
          validation: [],
          children: [
            {
              id: 'street',
              kind: 'text',
              label: 'Street',
              config: {},
              validation: [{ kind: 'required' }],
            },
          ],
        },
      ],
    }
    expect(fromJsonSchema(toJsonSchema(schema))).toEqual(schema)
    const v = compileFormValidator(schema.fields)
    expect(v.safeParse({ addr: { street: 'Main' } }).success).toBe(true)
    expect(v.safeParse({ addr: { street: '' } }).success).toBe(false)
  })
})

/**
 * Compile-time decoupling check: the imports above demonstrate the
 * Renderer pulls only from @/lib/form-designer/* (pure logic) and the
 * shared @/components/form-materials/* registry. No @/components/
 * form-designer/* imports anywhere — the ESLint rule in
 * eslint.config.mjs flags any future drift.
 */
describe('Renderer/Designer decoupling — import surface', () => {
  it('the form-renderer module exists and exports FormRenderer', async () => {
    const mod = (await import('./form-renderer')) as Record<string, unknown>
    expect(typeof mod.FormRenderer).toBe('function')
    expect(typeof mod.resolveDottedPath).toBe('function')
  })

  // Defense-in-depth: read the source bytes and assert no
  // form-designer import string survives. Cheap, deterministic,
  // catches a slip even if the ESLint rule is silenced.
  it('the form-renderer source has zero form-designer imports', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/components/form-renderer/form-renderer.tsx'),
      'utf-8',
    )
    expect(src.includes('@/components/form-designer/')).toBe(false)
    expect(src.includes("from '@/components/form-designer")).toBe(false)
    // It SHOULD import from form-materials (shared) and lib/form-designer (pure).
    expect(src.includes('@/components/form-materials/')).toBe(true)
    expect(src.includes('@/lib/form-designer/')).toBe(true)
  })
})

describe('AI assist banner detection (D16)', () => {
  // The banner mounts when ANY visible field has kind === 'llm-trigger'
  // OR a container child does. The pure detection logic is exported
  // via the form-renderer module's source — assert via source bytes
  // since we don't render in jsdom in this suite.
  it('the form-renderer source includes the hasAiAssist guard', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/components/form-renderer/form-renderer.tsx'),
      'utf-8',
    )
    expect(src).toContain('hasAiAssist')
    expect(src).toContain("'llm-trigger'")
  })
})

/** Type-only sanity: FieldNode is the canonical Renderer-side type. */
describe('schema types', () => {
  it('FieldNode and FormSchema are correctly exported', () => {
    const f: FieldNode = {
      id: 'x',
      kind: 'text',
      label: 'X',
      config: {},
      validation: [],
    }
    const s: FormSchema = {
      version: FORM_SCHEMA_VERSION,
      fields: [f],
    }
    expect(s.fields[0].id).toBe('x')
  })
})
