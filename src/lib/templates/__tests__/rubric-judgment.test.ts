import { describe, it, expect } from 'vitest'
import { getTemplate } from '../registry'
// Side-effect import registers every template (incl. rubric-judgment) so the
// registry lookup resolves — mirrors effective.test.ts.
import '../init'

/**
 * `rubric-judgment` template mode — single response, expert-authored rubric +
 * pass/fail verdict.
 *
 * Pins the frozen contract:
 *   - the mode registers under the 'rubric-judgment' key
 *   - its responseSchema accepts a valid submission (1..20 rubric items,
 *     per-item pass/fail judgments, an overallVerdict, optional notes)
 *   - it rejects a payload missing overallVerdict
 *   - it rejects an empty rubricItems array (the .min(1) floor)
 */

const VALID_PAYLOAD = {
  rubricItems: [
    {
      id: 'r1',
      name: 'Cites a source',
      description: 'The response names where the claim comes from.',
      expectation: 'A concrete citation, not a vague gesture.',
    },
    { id: 'r2', name: 'Directly answers the question' },
  ],
  judgments: { r1: 'pass', r2: 'fail' },
  overallVerdict: 'fail',
  notes: 'Cited a source but dodged the actual question.',
}

describe('rubric-judgment template', () => {
  it('is registered and looks up by mode', () => {
    const t = getTemplate('rubric-judgment')
    expect(t).toBeDefined()
    expect(t!.mode).toBe('rubric-judgment')
  })

  it('responseSchema accepts a valid submission', () => {
    const t = getTemplate('rubric-judgment')!
    const r = t.responseSchema.safeParse(VALID_PAYLOAD)
    expect(r.success).toBe(true)
  })

  it('responseSchema rejects a payload missing overallVerdict', () => {
    const t = getTemplate('rubric-judgment')!
    const { overallVerdict: _omitted, ...withoutVerdict } = VALID_PAYLOAD
    const r = t.responseSchema.safeParse(withoutVerdict)
    expect(r.success).toBe(false)
  })

  it('responseSchema rejects an empty rubricItems array', () => {
    const t = getTemplate('rubric-judgment')!
    const r = t.responseSchema.safeParse({ ...VALID_PAYLOAD, rubricItems: [] })
    expect(r.success).toBe(false)
  })
})
