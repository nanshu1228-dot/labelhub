import { describe, it, expect } from 'vitest'
import {
  aiAgentConfigSchema,
  DEFAULT_RUBRIC_JUDGMENT_CONFIG,
} from '../ai-agent-config-schema'

/**
 * DEFAULT_RUBRIC_JUDGMENT_CONFIG — the starter config for the
 * `rubric-judgment` template mode (rubric-authoring + judgement meta-review).
 *
 * Pins the frozen contract:
 *   - it parses cleanly through aiAgentConfigSchema (no .refine() violation)
 *   - taskKind is the underscored 'rubric_judgment'
 *   - it ships enabled (the mode exists FOR the AI meta-review)
 *   - two weighted dimensions: rubric_quality(40) + judgment_correctness(60),
 *     so a wrong judgement (the heavier-weighted, more damaging error) drives
 *     the verdict
 *   - sendBackAt < passAt (the threshold invariant the schema enforces)
 */
describe('DEFAULT_RUBRIC_JUDGMENT_CONFIG', () => {
  it('parses through aiAgentConfigSchema', () => {
    const parsed = aiAgentConfigSchema.safeParse(DEFAULT_RUBRIC_JUDGMENT_CONFIG)
    expect(parsed.success).toBe(true)
  })

  it('is the rubric_judgment task kind and ships enabled', () => {
    expect(DEFAULT_RUBRIC_JUDGMENT_CONFIG.taskKind).toBe('rubric_judgment')
    expect(DEFAULT_RUBRIC_JUDGMENT_CONFIG.enabled).toBe(true)
  })

  it('has the two weighted dimensions rubric_quality(40) + judgment_correctness(60)', () => {
    const dims = DEFAULT_RUBRIC_JUDGMENT_CONFIG.dimensions
    expect(dims).toHaveLength(2)
    const byId = Object.fromEntries(dims.map((d) => [d.id, d]))
    expect(Object.keys(byId).sort()).toEqual([
      'judgment_correctness',
      'rubric_quality',
    ])
    expect(byId.rubric_quality.weight).toBe(40)
    expect(byId.judgment_correctness.weight).toBe(60)
    // judgment_correctness is the heavier-weighted (more damaging) error.
    expect(byId.judgment_correctness.weight).toBeGreaterThan(
      byId.rubric_quality.weight!,
    )
  })

  it('keeps sendBackAt strictly below passAt', () => {
    expect(DEFAULT_RUBRIC_JUDGMENT_CONFIG.sendBackAt).toBeLessThan(
      DEFAULT_RUBRIC_JUDGMENT_CONFIG.passAt,
    )
  })
})
