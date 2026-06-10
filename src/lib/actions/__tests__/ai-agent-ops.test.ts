import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * retryAiReview recovery gate (WS1 fix E / WS2 / A11).
 *
 * A verdict can wedge a topic in 'ai_review' forever if the host process is
 * killed between the 'pending' insert and the verdict write (no thrown error
 * → no rollback). retryAiReview must recover such an ORPHANED pending row (one
 * older than the staleness threshold) as well as a 'failed' one, while leaving
 * a genuinely in-flight (fresh) pending and a completed verdict untouched.
 */

vi.mock('@/lib/db/client', () => ({ getDb: vi.fn() }))
vi.mock('@/lib/auth/guards', () => ({
  requireWorkspaceAdmin: vi.fn(async () => ({ user: { id: 'admin-1' } })),
}))
vi.mock('../ai-review-submission', () => ({
  scheduleAIReviewIfMissing: vi.fn().mockResolvedValue(undefined),
}))

import { retryAiReview } from '../ai-agent-ops'
import { getDb } from '@/lib/db/client'
import { scheduleAIReviewIfMissing } from '../ai-review-submission'

const ANNOTATION = '11111111-1111-4111-8111-111111111111'
const WS = '22222222-2222-4222-8222-222222222222'

function mountDb(verdictRow: Record<string, unknown> | null) {
  const queue: unknown[][] = [
    [{ topicId: 'topic-1', workspaceId: WS }], // annotation → topic → task join
    verdictRow ? [verdictRow] : [], // latest verdict
  ]
  let idx = 0
  const deletes: number[] = []
  const updates: Array<Record<string, unknown>> = []
  vi.mocked(getDb).mockReturnValue({
    select: () => {
      const rows = queue[idx++] ?? []
      const c: Record<string, unknown> = {}
      for (const k of ['from', 'innerJoin', 'where', 'orderBy']) c[k] = () => c
      c.limit = () => Promise.resolve(rows)
      return c
    },
    delete: () => ({
      where: () => {
        deletes.push(1)
        return Promise.resolve(undefined)
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values)
        return { where: () => Promise.resolve(undefined) }
      },
    }),
  } as never)
  return { deletes, updates }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('retryAiReview', () => {
  it('recovers a failed verdict (delete + reset + reschedule)', async () => {
    const { deletes, updates } = mountDb({
      id: 'v1',
      status: 'failed',
      startedAt: new Date(),
    })
    const res = await retryAiReview({ annotationId: ANNOTATION })
    expect(res.ok).toBe(true)
    expect(deletes.length).toBe(1)
    expect(updates[0]?.status).toBe('submitted')
    expect(vi.mocked(scheduleAIReviewIfMissing)).toHaveBeenCalledTimes(1)
  })

  it('recovers a STALE pending verdict (orphaned in-flight review)', async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)
    const { deletes } = mountDb({
      id: 'v1',
      status: 'pending',
      startedAt: tenMinAgo,
    })
    const res = await retryAiReview({ annotationId: ANNOTATION })
    expect(res.ok).toBe(true)
    expect(deletes.length).toBe(1)
    expect(vi.mocked(scheduleAIReviewIfMissing)).toHaveBeenCalledTimes(1)
  })

  it('refuses a FRESH pending verdict (a review genuinely in flight)', async () => {
    const { deletes } = mountDb({
      id: 'v1',
      status: 'pending',
      startedAt: new Date(), // just now
    })
    const res = await retryAiReview({ annotationId: ANNOTATION })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('pending_in_flight')
    expect(deletes.length).toBe(0)
    expect(vi.mocked(scheduleAIReviewIfMissing)).not.toHaveBeenCalled()
  })

  it('refuses a completed verdict', async () => {
    const { deletes } = mountDb({
      id: 'v1',
      status: 'completed',
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    const res = await retryAiReview({ annotationId: ANNOTATION })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('not_failed')
    expect(deletes.length).toBe(0)
  })

  it('returns not_found when the annotation does not exist', async () => {
    // Override the first select to return no annotation row.
    let idx = 0
    vi.mocked(getDb).mockReturnValue({
      select: () => {
        idx++
        const c: Record<string, unknown> = {}
        for (const k of ['from', 'innerJoin', 'where', 'orderBy']) c[k] = () => c
        c.limit = () => Promise.resolve([])
        return c
      },
    } as never)
    const res = await retryAiReview({ annotationId: ANNOTATION })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('not_found')
    expect(idx).toBe(1)
  })
})
