import { describe, it, expect } from 'vitest'
import {
  ASYNC_EXPORT_THRESHOLD_BYTES,
  estimateExportBytes,
} from './storage'

/**
 * Export-storage helper tests — Finals D21-D.
 *
 * Pure functions (`estimateExportBytes` + the
 * ASYNC_EXPORT_THRESHOLD_BYTES constant) get unit coverage so the
 * route's "should this go async?" decision is pinned + reviewable.
 * The Supabase upload path is exercised by manual smoke against the
 * gamma deploy, not unit-mocked here.
 */

describe('estimateExportBytes (D21-D)', () => {
  it('returns 0 for an empty dataset', () => {
    expect(estimateExportBytes({ itemCount: 0 })).toBe(0)
  })

  it('defaults to 2KB per row', () => {
    expect(estimateExportBytes({ itemCount: 100 })).toBe(200_000)
  })

  it('honors a custom avgBytesPerRow', () => {
    expect(
      estimateExportBytes({ itemCount: 100, avgBytesPerRow: 4_000 }),
    ).toBe(400_000)
  })

  it('crosses the 5MB threshold around 2_500 rows at the default size', () => {
    // 2_500 rows * 2_000 bytes = 5_000_000 bytes = threshold exactly.
    const bytes = estimateExportBytes({ itemCount: 2_500 })
    expect(bytes).toBe(ASYNC_EXPORT_THRESHOLD_BYTES)
  })

  it('Excel jobs cross the threshold faster (avgBytesPerRow=4_000)', () => {
    // 1_500 rows * 4_000 bytes = 6_000_000 bytes — above threshold.
    expect(
      estimateExportBytes({ itemCount: 1_500, avgBytesPerRow: 4_000 }),
    ).toBeGreaterThan(ASYNC_EXPORT_THRESHOLD_BYTES)
  })
})

describe('ASYNC_EXPORT_THRESHOLD_BYTES', () => {
  it('is exactly 5_000_000', () => {
    // Threshold value pinned. Changing this means the sync→async
    // boundary moves; reviewers should see the test diff.
    expect(ASYNC_EXPORT_THRESHOLD_BYTES).toBe(5_000_000)
  })
})
