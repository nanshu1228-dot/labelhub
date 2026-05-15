import { describe, it, expect } from 'vitest'
import { dimensionGsb } from '@/lib/templates/modes/arena-gsb'

/**
 * Pure-math test of the GSB derivation. The query layer's wiring is
 * exercised in the disputes-page integration test (not yet written —
 * tracked separately); here we just nail the formula.
 */
describe('dimensionGsb — winner picked by larger score', () => {
  it('A wins when scoreA > scoreB', () => {
    expect(dimensionGsb(5, 3)).toBe('A')
    expect(dimensionGsb(4, 3)).toBe('A')
    expect(dimensionGsb(2, 1)).toBe('A')
  })

  it('B wins when scoreB > scoreA', () => {
    expect(dimensionGsb(3, 5)).toBe('B')
    expect(dimensionGsb(1, 2)).toBe('B')
  })

  it('tie when scores match', () => {
    expect(dimensionGsb(3, 3)).toBe('tie')
    expect(dimensionGsb(1, 1)).toBe('tie')
    expect(dimensionGsb(5, 5)).toBe('tie')
  })
})

// The boolean-disagreement and Likert-spread checks in pair-iaa.ts are
// inlined Map reductions over loaded rows. Integration-testing them
// requires a real or fully-mocked DB — covered by the manual E2E walk
// and the existing iaa-math.test.ts (which tests the spread/tolerance
// primitives used).
