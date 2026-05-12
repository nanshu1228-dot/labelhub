import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { registerTemplate, getTemplate } from './registry'
import type { PlatformTemplate, TemplateMode } from './types'

const base = (overrides: Partial<PlatformTemplate> = {}): PlatformTemplate => ({
  mode: 'arena-battle' as TemplateMode,
  name: 'Test Template',
  description: 'test',
  itemSchema: z.object({}),
  responseSchema: z.object({}),
  workflow: ['drafting', 'submitted'],
  perfBudget: {
    maxItemsPerCell: 10,
    virtualizationRequired: false,
    atomicStateRequired: false,
    autoSavePolicy: 'on-submit',
  },
  economy: { type: 'volunteer' },
  ui: { theme: 'classic', layout: 'single-column' },
  ...overrides,
})

describe('Template registry — perf budget enforcement', () => {
  it('accepts a small grid without virtualization', () => {
    expect(() =>
      registerTemplate(base({ mode: 'arena-battle' })),
    ).not.toThrow()
    expect(getTemplate('arena-battle')).toBeDefined()
  })

  it('REJECTS 1000-item grid without virtualization (the 50-rubric-jank failure mode)', () => {
    expect(() =>
      registerTemplate(
        base({
          mode: 'token-economy',
          perfBudget: {
            maxItemsPerCell: 1000,
            virtualizationRequired: false, // bad: would jank past ~50 rows
            atomicStateRequired: true,
            autoSavePolicy: 'on-blur',
          },
        }),
      ),
    ).toThrow(/virtualizationRequired=true/)
  })

  it('REJECTS 200-item grid without atomic state (parent re-render cascade)', () => {
    expect(() =>
      registerTemplate(
        base({
          mode: 'game-mode',
          perfBudget: {
            maxItemsPerCell: 200,
            virtualizationRequired: true,
            atomicStateRequired: false, // bad: every toggle triggers full list reconcile
            autoSavePolicy: 'on-blur',
          },
        }),
      ),
    ).toThrow(/atomicStateRequired=true/)
  })

  it('accepts a 1000-row grid that declares the full safe contract', () => {
    expect(() =>
      registerTemplate(
        base({
          mode: 'apprentice-mode',
          perfBudget: {
            maxItemsPerCell: 1000,
            virtualizationRequired: true,
            atomicStateRequired: true,
            autoSavePolicy: 'debounce-500ms',
            maxResponseLengthChars: 50000,
          },
        }),
      ),
    ).not.toThrow()
  })
})
