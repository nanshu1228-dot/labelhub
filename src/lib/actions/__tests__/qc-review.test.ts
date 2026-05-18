import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all upstream dependencies before importing the module under test.
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
}))
vi.mock('@/lib/webhooks/fanout', () => ({
  fanoutWebhook: vi.fn(async () => undefined),
}))
// next/server's after() is just a synchronous-ish callback registry.
// In tests we ignore the deferred work — the unit under test is the
// action's contract, not the webhook side-effects.
vi.mock('next/server', () => ({
  after: vi.fn((fn: () => unknown) => {
    // Don't actually run the deferred fn — it would invoke the (mocked)
    // webhook fanout. Test asserts on the function contract, not on
    // background effects.
    void fn
  }),
}))
// Maintenance pass: qcReviewAnnotation now calls revalidatePath after
// the verdict commits. Stub it — the real implementation needs a
// static-generation store that vitest doesn't provide.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { qcReviewAnnotation } from '../qc-review'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/errors'
import { getDb } from '@/lib/db/client'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * qcReviewAnnotation — verify the action × role × source-state matrix in
 * docs/ROLE_PERMISSIONS.md.
 *
 * Authoritative rules under test:
 *   1. Only admin OR qc roles may invoke it (annotator + viewer get
 *      ForbiddenError before the source-state check).
 *   2. Allowed source states: `submitted`, `reviewing`. Everything else
 *      throws ConflictError.
 *   3. Self-QC is blocked — submitter cannot QC their own annotation.
 *   4. `pass` transitions to `awaiting_acceptance`; `request_revision`
 *      transitions to `revising`.
 *   5. Cross-tenant: workspace gate authorizes against the resource's
 *      OWN workspace (we resolve task → workspaceId before requireQC).
 */

const SUBMITTER = 'submitter-1'
const REVIEWER = 'reviewer-1'

const ANNOTATION = {
  // Valid v4 UUID — z.string().uuid() rejects placeholder all-1s.
  id: '11111111-1111-4111-8111-111111111111',
  topicId: 't-1',
  userId: SUBMITTER,
  payload: {},
  version: 1,
}

const TOPIC_BASE = {
  id: 't-1',
  taskId: 'task-1',
  status: 'submitted',
  version: 0,
  assignedTo: SUBMITTER,
}

const TASK = {
  id: 'task-1',
  workspaceId: 'ws-1',
  templateMode: 'survey',
}

const WORKSPACE = {
  id: 'ws-1',
  name: 'Test WS',
  adminId: 'creator-of-ws',
}

/**
 * Set up the Supabase + DB mocks. Returns the configured topic so
 * assertions can compare. The DB mock services the action's query
 * sequence in order:
 *
 *   1. select annotations               (return [ANNOTATION])
 *   2. select topics                    (return [topic])
 *   3. select tasks                     (return [TASK])
 *   4. select workspaces+members        (via requireWorkspaceMember inside requireQC)
 *   5. update topics                    (returning [updatedTopic])
 *   6. insert events                    (no-op)
 *
 * Mirror upsert in requireUser also calls insert; same no-op handler.
 */
function setupScenario(opts: {
  reviewerId: string
  reviewerEmail?: string
  topicStatus: typeof TOPIC_BASE.status
  /** Role returned by the workspace_members lookup */
  reviewerRole: 'admin' | 'qc' | 'annotator' | 'viewer' | null
  /** Override annotation.userId to test self-QC */
  annotationOwnerId?: string
  /** Force update.returning() to return [] (concurrent-write conflict) */
  updateConflict?: boolean
}) {
  const topic = { ...TOPIC_BASE, status: opts.topicStatus }
  const annotation = {
    ...ANNOTATION,
    userId: opts.annotationOwnerId ?? SUBMITTER,
  }

  vi.mocked(getSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: opts.reviewerId,
            email: opts.reviewerEmail ?? `${opts.reviewerId}@labelhub.dev`,
            user_metadata: {},
          },
        },
        error: null,
      }),
    },
  } as never)

  // Queue of select() results, drained in order.
  const selectQueue: unknown[][] = [
    [annotation],
    [topic],
    [TASK],
    // requireWorkspaceMember query — workspace row with the reviewer's role.
    [{ workspace: WORKSPACE, role: opts.reviewerRole }],
  ]
  let selectIdx = 0

  const updateReturning = opts.updateConflict
    ? []
    : [{ ...topic, status: 'awaiting_acceptance', version: topic.version + 1 }]

  vi.mocked(getDb).mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectQueue[selectIdx++] ?? []),
        }),
        leftJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectQueue[selectIdx++] ?? []),
          }),
        }),
      }),
    }),
    insert: () => ({
      // For both `events` insert and `users` mirror upsert.
      values: () => {
        const thenable = {
          then(onFulfilled: (v: unknown) => unknown) {
            return Promise.resolve().then(onFulfilled)
          },
          onConflictDoNothing() {
            return Promise.resolve()
          },
        }
        return thenable
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updateReturning),
        }),
      }),
    }),
  } as never)

  return { topic, annotation }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Role × source-state matrix ──────────────────────────────────────────

describe('qcReviewAnnotation — role gate', () => {
  // From docs/ROLE_PERMISSIONS.md: admin + qc pass; annotator + viewer blocked.
  it.each([
    ['admin' as const, true],
    ['qc' as const, true],
    ['annotator' as const, false],
    ['viewer' as const, false],
    [null, false],
  ])('reviewerRole=%s → allowed=%s', async (role, allowed) => {
    setupScenario({
      reviewerId: REVIEWER,
      reviewerRole: role,
      topicStatus: 'submitted',
    })

    if (allowed) {
      const result = await qcReviewAnnotation({
        annotationId: ANNOTATION.id,
        decision: 'pass',
      })
      expect(result).toEqual({ ok: true, next: 'awaiting_acceptance' })
    } else {
      await expect(
        qcReviewAnnotation({
          annotationId: ANNOTATION.id,
          decision: 'pass',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError)
    }
  })
})

describe('qcReviewAnnotation — source-state matrix', () => {
  // From docs/ROLE_PERMISSIONS.md: only `submitted` and `reviewing` are
  // allowed. Other statuses → ConflictError.
  const ALLOWED_STATES = ['submitted', 'reviewing'] as const
  const BLOCKED_STATES = [
    'drafting',
    'revising',
    'awaiting_acceptance',
    'approved',
    'rejected',
  ] as const

  it.each(ALLOWED_STATES)(
    'status=%s + decision=pass → next=awaiting_acceptance',
    async (status) => {
      setupScenario({
        reviewerId: REVIEWER,
        reviewerRole: 'qc',
        topicStatus: status,
      })
      const result = await qcReviewAnnotation({
        annotationId: ANNOTATION.id,
        decision: 'pass',
      })
      expect(result).toEqual({ ok: true, next: 'awaiting_acceptance' })
    },
  )

  it.each(ALLOWED_STATES)(
    'status=%s + decision=request_revision → next=revising',
    async (status) => {
      setupScenario({
        reviewerId: REVIEWER,
        reviewerRole: 'qc',
        topicStatus: status,
      })
      const result = await qcReviewAnnotation({
        annotationId: ANNOTATION.id,
        decision: 'request_revision',
        feedback: 'please redo step 3',
      })
      expect(result).toEqual({ ok: true, next: 'revising' })
    },
  )

  it.each(BLOCKED_STATES)(
    'status=%s → ConflictError regardless of decision',
    async (status) => {
      setupScenario({
        reviewerId: REVIEWER,
        reviewerRole: 'qc',
        topicStatus: status,
      })
      await expect(
        qcReviewAnnotation({
          annotationId: ANNOTATION.id,
          decision: 'pass',
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    },
  )
})

describe('qcReviewAnnotation — self-QC block', () => {
  it('throws ConflictError when reviewer is the original submitter', async () => {
    // Submitter is a qc-role user — they can review others, but NOT their
    // own work. The check is independent of role.
    setupScenario({
      reviewerId: SUBMITTER,
      reviewerRole: 'qc',
      topicStatus: 'submitted',
      annotationOwnerId: SUBMITTER,
    })
    await expect(
      qcReviewAnnotation({
        annotationId: ANNOTATION.id,
        decision: 'pass',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('also blocks self-QC for an admin who happened to submit', async () => {
    setupScenario({
      reviewerId: SUBMITTER,
      reviewerRole: 'admin',
      topicStatus: 'submitted',
      annotationOwnerId: SUBMITTER,
    })
    await expect(
      qcReviewAnnotation({
        annotationId: ANNOTATION.id,
        decision: 'request_revision',
        feedback: 'I screwed up step 2',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('qcReviewAnnotation — resource resolution', () => {
  it('throws NotFoundError when annotation does not exist', async () => {
    // First select returns empty → NotFoundError immediately. The role
    // check is never reached, which is the right thing: don't leak
    // existence based on auth.
    vi.mocked(getSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: {
            user: { id: REVIEWER, email: 'r@x.dev', user_metadata: {} },
          },
          error: null,
        }),
      },
    } as never)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => Promise.resolve(),
        }),
      }),
    } as never)

    await expect(
      qcReviewAnnotation({
        annotationId: ANNOTATION.id,
        decision: 'pass',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ConflictError on optimistic-lock race (update.returning() empty)', async () => {
    setupScenario({
      reviewerId: REVIEWER,
      reviewerRole: 'qc',
      topicStatus: 'submitted',
      updateConflict: true,
    })
    await expect(
      qcReviewAnnotation({
        annotationId: ANNOTATION.id,
        decision: 'pass',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('qcReviewAnnotation — input validation', () => {
  it('rejects malformed annotationId', async () => {
    setupScenario({
      reviewerId: REVIEWER,
      reviewerRole: 'qc',
      topicStatus: 'submitted',
    })
    await expect(
      qcReviewAnnotation({
        annotationId: 'not-a-uuid',
        decision: 'pass',
      }),
    ).rejects.toThrow()
  })

  it('rejects invalid decision enum', async () => {
    setupScenario({
      reviewerId: REVIEWER,
      reviewerRole: 'qc',
      topicStatus: 'submitted',
    })
    await expect(
      qcReviewAnnotation({
        annotationId: ANNOTATION.id,
        // 'approve' is admin-only; not a qc decision. Schema rejects.
        // @ts-expect-error — testing schema rejection on bad input
        decision: 'approve',
      }),
    ).rejects.toThrow()
  })

  it('accepts feedback within length limit', async () => {
    setupScenario({
      reviewerId: REVIEWER,
      reviewerRole: 'qc',
      topicStatus: 'submitted',
    })
    const result = await qcReviewAnnotation({
      annotationId: ANNOTATION.id,
      decision: 'request_revision',
      feedback: 'a'.repeat(2000),
    })
    expect(result.next).toBe('revising')
  })

  it('rejects feedback over length limit', async () => {
    setupScenario({
      reviewerId: REVIEWER,
      reviewerRole: 'qc',
      topicStatus: 'submitted',
    })
    await expect(
      qcReviewAnnotation({
        annotationId: ANNOTATION.id,
        decision: 'request_revision',
        feedback: 'a'.repeat(2001),
      }),
    ).rejects.toThrow()
  })
})
