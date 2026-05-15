import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { registerTemplate, getTemplate } from './registry'
import type { PlatformTemplate, TemplateMode } from './types'

/**
 * Tests use placeholder mode strings cast to TemplateMode to exercise the
 * validation guard without clobbering the real templates registered by
 * init.ts. The cast is the standard escape hatch — these test templates
 * never get registered against a shipping mode name.
 */
const base = (overrides: Partial<PlatformTemplate> = {}): PlatformTemplate => ({
  mode: '__test_mode_default__' as TemplateMode,
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
      registerTemplate(base({ mode: '__test_small_grid__' as TemplateMode })),
    ).not.toThrow()
    expect(getTemplate('__test_small_grid__' as TemplateMode)).toBeDefined()
  })

  it('REJECTS 1000-item grid without virtualization (the 50-rubric-jank failure mode)', () => {
    expect(() =>
      registerTemplate(
        base({
          mode: '__test_large_no_virt__' as TemplateMode,
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
          mode: '__test_no_atomic__' as TemplateMode,
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
          mode: '__test_safe_contract__' as TemplateMode,
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
