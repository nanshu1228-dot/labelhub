import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/actions/qc-review', () => ({
  qcReviewAnnotation: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { batchReviewAnnotations } from '../review-batch'
import { qcReviewAnnotation } from '../qc-review'

/**
 * Batch review action tests — Finals P3 D11.
 *
 * The batch helper sequentially dispatches each annotationId through
 * qcReviewAnnotation, collecting per-row success/failure. The Reviewer
 * UI surfaces partial-success so a 20-item queue with one stale row
 * doesn't lose the other 19 approvals.
 */

const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('batchReviewAnnotations — validation', () => {
  it('rejects an empty list via Zod', async () => {
    await expect(
      batchReviewAnnotations({
        annotationIds: [],
        decision: 'approve',
      }),
    ).rejects.toThrow()
  })

  it('rejects more than 200 ids', async () => {
    const ids = Array.from(
      { length: 201 },
      (_, i) =>
        `${i.toString().padStart(8, '0')}-1111-4111-8111-111111111111`,
    )
    await expect(
      batchReviewAnnotations({ annotationIds: ids, decision: 'approve' }),
    ).rejects.toThrow()
  })

  it('rejects invalid uuid shapes', async () => {
    await expect(
      batchReviewAnnotations({
        annotationIds: ['not-a-uuid'],
        decision: 'approve',
      }),
    ).rejects.toThrow()
  })
})

describe('batchReviewAnnotations — dispatch', () => {
  it('approves: maps to qc-review pass', async () => {
    vi.mocked(qcReviewAnnotation).mockResolvedValue({
      ok: true,
      next: 'awaiting_acceptance',
    } as never)
    const result = await batchReviewAnnotations({
      annotationIds: IDS,
      decision: 'approve',
    })
    expect(result.succeeded).toEqual(IDS)
    expect(result.failed).toEqual([])
    expect(vi.mocked(qcReviewAnnotation)).toHaveBeenCalledTimes(3)
    for (const call of vi.mocked(qcReviewAnnotation).mock.calls) {
      expect(call[0].decision).toBe('pass')
    }
  })

  it('request_revision: maps to qc-review request_revision + threads feedback', async () => {
    vi.mocked(qcReviewAnnotation).mockResolvedValue({
      ok: true,
      next: 'revising',
    } as never)
    const result = await batchReviewAnnotations({
      annotationIds: IDS,
      decision: 'request_revision',
      feedback: 'incomplete',
    })
    expect(result.succeeded).toEqual(IDS)
    for (const call of vi.mocked(qcReviewAnnotation).mock.calls) {
      expect(call[0].decision).toBe('request_revision')
      expect(call[0].feedback).toBe('incomplete')
    }
  })

  it('partial success: failed rows captured separately', async () => {
    vi.mocked(qcReviewAnnotation)
      .mockResolvedValueOnce({ ok: true, next: 'awaiting_acceptance' } as never)
      .mockRejectedValueOnce(new Error('Topic was modified concurrently'))
      .mockResolvedValueOnce({ ok: true, next: 'awaiting_acceptance' } as never)
    const result = await batchReviewAnnotations({
      annotationIds: IDS,
      decision: 'approve',
    })
    expect(result.succeeded).toEqual([IDS[0], IDS[2]])
    expect(result.failed).toEqual([
      { annotationId: IDS[1], error: 'Topic was modified concurrently' },
    ])
  })

  it('all-fail returns empty succeeded + all rows in failed', async () => {
    vi.mocked(qcReviewAnnotation).mockRejectedValue(new Error('forbidden'))
    const result = await batchReviewAnnotations({
      annotationIds: IDS,
      decision: 'approve',
    })
    expect(result.succeeded).toEqual([])
    expect(result.failed.map((f) => f.annotationId)).toEqual(IDS)
  })

  it('serial dispatch — each call awaits before the next', async () => {
    const order: string[] = []
    vi.mocked(qcReviewAnnotation).mockImplementation(async (input: unknown) => {
      const id = (input as { annotationId: string }).annotationId
      order.push(`start:${id}`)
      await new Promise((r) => setTimeout(r, 5))
      order.push(`end:${id}`)
      return { ok: true, next: 'awaiting_acceptance' } as never
    })
    await batchReviewAnnotations({
      annotationIds: IDS,
      decision: 'approve',
    })
    // The first call must fully complete before the second starts.
    for (let i = 0; i < IDS.length; i++) {
      expect(order[2 * i]).toBe(`start:${IDS[i]}`)
      expect(order[2 * i + 1]).toBe(`end:${IDS[i]}`)
    }
  })
})
