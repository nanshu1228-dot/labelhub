import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '@/lib/db/client'
import { getReviewThread } from './review-thread'

function mountDb(selectQueue: unknown[][]) {
  let idx = 0
  const terminal = () => Promise.resolve(selectQueue[idx++] ?? [])
  const builder: unknown = {
    from: () => builder,
    innerJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: terminal,
    then: (resolve: (rows: unknown[]) => void, reject?: (e: unknown) => void) =>
      terminal().then(resolve, reject),
  }
  vi.mocked(getDb).mockReturnValue({
    select: () => builder,
  } as unknown as ReturnType<typeof getDb>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getReviewThread', () => {
  it('surfaces AI send-back reasons as review-thread messages', async () => {
    const annotationId = 'ann-1'
    const submitterId = 'user-submitter'
    const aiTs = new Date('2026-05-01T08:00:00Z')
    const replyTs = new Date('2026-05-01T08:10:00Z')

    mountDb([
      [
        {
          id: 'evt-ai',
          type: 'ai_review.sent_back',
          ts: aiTs,
          actorId: null,
          payload: {
            annotationId,
            reason: 'Please add evidence for the final answer.',
          },
        },
        {
          id: 'evt-other',
          type: 'ai_review.sent_back',
          ts: aiTs,
          actorId: null,
          payload: {
            annotationId: 'other-annotation',
            reason: 'This should be filtered out.',
          },
        },
        {
          id: 'evt-reply',
          type: 'annotation.review_replied',
          ts: replyTs,
          actorId: submitterId,
          payload: {
            annotationId,
            message: 'Added the missing evidence.',
          },
        },
      ],
      [
        {
          id: submitterId,
          displayName: 'Dana',
          email: 'dana@example.com',
        },
      ],
      [{ userId: submitterId }],
    ])

    const messages = await getReviewThread({ annotationId })

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      eventId: 'evt-ai',
      authorRole: 'ai',
      authorId: null,
      authorDisplayName: null,
      kind: 'ai_sent_back',
      message: 'Please add evidence for the final answer.',
    })
    expect(messages[1]).toMatchObject({
      eventId: 'evt-reply',
      authorRole: 'submitter',
      authorDisplayName: 'Dana',
      kind: 'reply',
      message: 'Added the missing evidence.',
    })
  })
})
