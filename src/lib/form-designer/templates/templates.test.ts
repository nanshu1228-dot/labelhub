import { describe, it, expect } from 'vitest'
import {
  OFFICIAL_TEMPLATES,
  PREFERENCE_COMPARE_TEMPLATE,
  QA_QUALITY_TEMPLATE,
  getTemplate,
  listTemplates,
} from './index'
import { FIELD_KINDS, formSchemaSchema } from '../schema'

/**
 * Official template gallery tests — Finals D19-C.
 *
 * The gallery's correctness gate is: each template parses cleanly
 * through the canonical FormSchema parser, covers the spec's
 * required material set, and has stable IDs the seed script can
 * pin against.
 */

describe('OFFICIAL_TEMPLATES — wire-up', () => {
  it('ships exactly the two official templates', () => {
    expect(OFFICIAL_TEMPLATES.map((t) => t.id).sort()).toEqual([
      'preference-compare',
      'qa-quality',
    ])
  })

  it('every template parses through formSchemaSchema (cold path)', () => {
    for (const t of OFFICIAL_TEMPLATES) {
      const parsed = formSchemaSchema.safeParse(t.schema)
      expect(parsed.success).toBe(true)
    }
  })

  it('getTemplate returns the right template + null on miss', () => {
    expect(getTemplate('qa-quality')?.schema).toBe(QA_QUALITY_TEMPLATE)
    expect(getTemplate('preference-compare')?.schema).toBe(
      PREFERENCE_COMPARE_TEMPLATE,
    )
    expect(getTemplate('does-not-exist')).toBeUndefined()
  })

  it('listTemplates returns id/label/description triples only', () => {
    const list = listTemplates()
    expect(list).toHaveLength(2)
    for (const item of list) {
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('label')
      expect(item).toHaveProperty('description')
      expect(item).not.toHaveProperty('schema')
    }
  })
})

describe('QA_QUALITY_TEMPLATE — coverage of standards', () => {
  const kinds = QA_QUALITY_TEMPLATE.fields.map((f) => f.kind)

  it('includes at least one of every adopted material', () => {
    // The qa_quality template should cover ShowItem + single-select
    // + multi-select + text + textarea + rich-text + json-editor +
    // file-upload + llm-trigger. Group / tab-layout are container
    // primitives, not required for this template.
    const required = [
      'show-item',
      'single-select',
      'multi-select',
      'text',
      'textarea',
      'rich-text',
      'json-editor',
      'file-upload',
      'llm-trigger',
    ]
    for (const k of required) {
      expect(kinds).toContain(k)
    }
  })

  it('has the four 1-5 rating dimensions', () => {
    const ratingIds = QA_QUALITY_TEMPLATE.fields
      .filter((f) => f.id.startsWith('rating_'))
      .map((f) => f.id)
    expect(ratingIds.sort()).toEqual([
      'rating_accuracy',
      'rating_format',
      'rating_relevance',
      'rating_safety',
    ])
  })

  it('all ids are unique', () => {
    const ids = QA_QUALITY_TEMPLATE.fields.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses FieldKind values from the canonical FIELD_KINDS set', () => {
    for (const f of QA_QUALITY_TEMPLATE.fields) {
      expect(FIELD_KINDS).toContain(f.kind)
    }
  })

  it('rating fields use horizontal layout for 1-5 chips', () => {
    const ratings = QA_QUALITY_TEMPLATE.fields.filter((f) =>
      f.id.startsWith('rating_'),
    )
    for (const r of ratings) {
      expect(
        (r.config as { layout?: string }).layout,
      ).toBe('horizontal')
    }
  })
})

describe('PREFERENCE_COMPARE_TEMPLATE — coverage', () => {
  it('includes a single-select with A/B/tie options', () => {
    const preferred = PREFERENCE_COMPARE_TEMPLATE.fields.find(
      (f) => f.id === 'preferred',
    )
    expect(preferred).toBeDefined()
    const opts = (
      preferred?.config as {
        options?: Array<{ value: string }>
      }
    ).options
    expect(opts?.map((o) => o.value).sort()).toEqual(['A', 'B', 'tie'])
  })

  it('has both response_a and response_b ShowItems', () => {
    const ids = PREFERENCE_COMPARE_TEMPLATE.fields.map((f) => f.id)
    expect(ids).toContain('show_response_a')
    expect(ids).toContain('show_response_b')
  })

  it('annotator_note is required (spec calls this out by name)', () => {
    const note = PREFERENCE_COMPARE_TEMPLATE.fields.find(
      (f) => f.id === 'annotator_note',
    )
    expect(note?.validation).toContainEqual({ kind: 'required' })
  })
})

describe('aiDimensions hint travels with each template', () => {
  it('qa-quality lists 4 review dimensions', () => {
    const t = getTemplate('qa-quality')!
    expect(t.aiDimensions.length).toBe(4)
    expect(t.aiDimensions.map((d) => d.id)).toEqual([
      'relevance',
      'accuracy',
      'format',
      'safety',
    ])
  })

  it('preference-compare lists 5 review dimensions', () => {
    const t = getTemplate('preference-compare')!
    expect(t.aiDimensions.length).toBe(5)
  })
})
