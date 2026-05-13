import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  rubricsForStepKind,
  rubricSpecSchema,
  isMarkPopulated,
  isMarkMissingReason,
  type RubricItem,
  type RubricSpec,
  type Mark,
} from './rubric'
import { registerTemplate } from './registry'
import type { PlatformTemplate } from './types'

describe('rubric.rubricsForStepKind — appliesTo filtering', () => {
  const spec: RubricSpec = {
    perStep: [
      { id: 'tool_choice', name: 'Tool choice', scale: 'likert', appliesTo: ['tool_call'] },
      { id: 'reasoning_sound', name: 'Reasoning sound', scale: 'likert', appliesTo: ['thinking', 'final_response'] },
      { id: 'safety', name: 'Safety', scale: 'bool', appliesTo: ['*'] },
      // No appliesTo at all → default "applies to everything"
      { id: 'notes', name: 'Notes', scale: 'text' },
    ],
    perTrajectory: [],
  }

  it('returns only items whose appliesTo includes the kind', () => {
    const out = rubricsForStepKind(spec, 'tool_call')
    expect(out.map((r) => r.id).sort()).toEqual(['notes', 'safety', 'tool_choice'])
  })

  it('returns the universal-and-reasoning items for thinking', () => {
    const out = rubricsForStepKind(spec, 'thinking')
    expect(out.map((r) => r.id).sort()).toEqual(['notes', 'reasoning_sound', 'safety'])
  })

  it('returns universal-only items for error', () => {
    const out = rubricsForStepKind(spec, 'error')
    expect(out.map((r) => r.id).sort()).toEqual(['notes', 'safety'])
  })

  it('handles per-trajectory items having no appliesTo (always returns empty per-step filter)', () => {
    expect(rubricsForStepKind({ perStep: [], perTrajectory: [] }, 'tool_call')).toEqual([])
  })
})

describe('rubric.rubricSpecSchema — runtime validation', () => {
  it('accepts a well-formed spec', () => {
    const good: RubricSpec = {
      perStep: [{ id: 'tool_choice', name: 'Tool choice', scale: 'likert', appliesTo: ['tool_call'] }],
      perTrajectory: [
        { id: 'path_optimality', name: 'Path optimality', scale: 'enum', options: ['optimal', 'suboptimal', 'incorrect'] },
      ],
    }
    expect(rubricSpecSchema.safeParse(good).success).toBe(true)
  })

  it('REJECTS enum without options (storage would be unconstrained string)', () => {
    const bad: any = {
      perStep: [{ id: 'path', name: 'Path', scale: 'enum' }],
      perTrajectory: [],
    }
    expect(rubricSpecSchema.safeParse(bad).success).toBe(false)
  })

  it('REJECTS non-enum with options (UI would render an unused field)', () => {
    const bad: any = {
      perStep: [{ id: 'safety', name: 'Safety', scale: 'bool', options: ['yes', 'no'] }],
      perTrajectory: [],
    }
    expect(rubricSpecSchema.safeParse(bad).success).toBe(false)
  })

  it('REJECTS ids not in snake_case (storage-key safety)', () => {
    const bad: any = {
      perStep: [{ id: 'ToolChoice', name: 'Tool choice', scale: 'likert' }],
      perTrajectory: [],
    }
    expect(rubricSpecSchema.safeParse(bad).success).toBe(false)
  })
})

describe('rubric — Mark helpers', () => {
  it('treats unset mark as not populated', () => {
    expect(isMarkPopulated(undefined)).toBe(false)
    expect(isMarkPopulated(null)).toBe(false)
  })

  it('treats empty-string text mark as not populated (whitespace counts as empty)', () => {
    const m: Mark = { scale: 'text', value: '   ' }
    expect(isMarkPopulated(m)).toBe(false)
  })

  it('treats false bool mark as populated (false is a real answer)', () => {
    const m: Mark = { scale: 'bool', value: false }
    expect(isMarkPopulated(m)).toBe(true)
  })

  it('flags missing reason when requiresReason=true and reason is blank', () => {
    const item: RubricItem = {
      id: 'tool_choice',
      name: 'Tool choice',
      scale: 'likert',
      requiresReason: true,
      appliesTo: ['tool_call'],
    }
    const rated: Mark = { scale: 'likert', value: 3 }
    expect(isMarkMissingReason(item, rated)).toBe(true)
  })

  it('does NOT flag when reason is present', () => {
    const item: RubricItem = {
      id: 'tool_choice',
      name: 'Tool choice',
      scale: 'likert',
      requiresReason: true,
    }
    const rated: Mark = { scale: 'likert', value: 3, reason: 'args missing unit' }
    expect(isMarkMissingReason(item, rated)).toBe(false)
  })

  it('does NOT flag when requiresReason is false (reason is optional)', () => {
    const item: RubricItem = { id: 'safety', name: 'Safety', scale: 'bool' }
    const rated: Mark = { scale: 'bool', value: true }
    expect(isMarkMissingReason(item, rated)).toBe(false)
  })

  it('does NOT flag when the mark itself is empty (no rating → no reason expected)', () => {
    const item: RubricItem = {
      id: 'tool_choice',
      name: 'Tool choice',
      scale: 'likert',
      requiresReason: true,
    }
    expect(isMarkMissingReason(item, undefined)).toBe(false)
  })
})

describe('registry — rubric integration', () => {
  const baseTemplate = (rubric: RubricSpec): PlatformTemplate => ({
    mode: 'arena-battle',
    name: 'Rubric Test',
    description: 'test',
    itemSchema: z.object({}),
    responseSchema: z.object({}),
    rubric,
    workflow: ['drafting', 'submitted'],
    perfBudget: {
      maxItemsPerCell: 10,
      virtualizationRequired: false,
      atomicStateRequired: false,
      autoSavePolicy: 'on-submit',
    },
    economy: { type: 'volunteer' },
    ui: { theme: 'classic', layout: 'single-column' },
  })

  it('REJECTS duplicate rubric ids across perStep + perTrajectory (shared payload namespace)', () => {
    expect(() =>
      registerTemplate(
        baseTemplate({
          perStep: [{ id: 'safety', name: 'Step safety', scale: 'bool' }],
          perTrajectory: [{ id: 'safety', name: 'Overall safety', scale: 'bool' }],
        }),
      ),
    ).toThrow(/duplicate item ids/)
  })

  it('REJECTS malformed rubric (enum without options) at registration time', () => {
    expect(() =>
      registerTemplate(
        baseTemplate({
          perStep: [],
          perTrajectory: [{ id: 'path', name: 'Path', scale: 'enum' } as RubricItem],
        }),
      ),
    ).toThrow(/rubric failed validation/)
  })
})
