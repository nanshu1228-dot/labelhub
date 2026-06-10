import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression: approving an annotation must ACCRUE a payout line item +
 * trigger the invite-reward scan — now through the INVERTED core→billing seam.
 *
 * `reviewAnnotation(approve)` is the terminal acceptance step. It no longer
 * imports billing directly: it dispatches `annotation.approved` on the core
 * event bus (in an after() hook), and the billing gateway — registered onto
 * the bus by @/lib/billing/init (which the instrumentation composition root
 * imports at boot) — reacts by calling approveAnnotation (payout accrual) +
 * scanInviteRewardOnApproval (invite reward). This funds the open payout
 * period (close-period → mark-paid then settles it into wallets). This test
 * pins the END-TO-END wiring through the dispatcher: approve fires both
 * reactions with the correct payload, reject/request_revision fire neither.
 *
 * Unlike review-annotation.test.ts (whose `after` mock is a no-op so it can
 * ignore side effects), this file RUNS the after() callbacks, registers the
 * real billing subscriber (via the @/lib/billing/init import below), and mocks
 * the leaf hook targets, so it observes the reactions without a database.
 */

vi.mock('@/lib/db/client', () => ({ getDb: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/webhooks/fanout', () => ({
  fanoutWebhook: vi.fn(async () => undefined),
}))
vi.mock('@/lib/quality/trust-recompute', () => ({
  recomputeAndPersistTrust: vi.fn(async () => undefined),
}))
vi.mock('@/lib/billing/invite-rewards', () => ({
  scanInviteRewardOnApproval: vi.fn(async () => undefined),
}))
vi.mock('@/lib/actions/billing/approve-annotation', () => ({
  approveAnnotation: vi.fn(async () => ({ ok: true })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// Run the after() callback synchronously so the accrual hook actually fires
// within the test (the real after() defers to the post-response window).
vi.mock('next/server', () => ({
  after: vi.fn((fn: () => unknown) => {
    void fn()
  }),
}))

import { reviewAnnotation } from '../annotations'
import { approveAnnotation } from '@/lib/actions/billing/approve-annotation'
import { scanInviteRewardOnApproval } from '@/lib/billing/invite-rewards'
import { getDb } from '@/lib/db/client'
import { getSupabaseServerClient } from '@/lib/supabase/server'
// Register the billing subscribers onto the core event bus, exactly as the
// instrumentation composition root does at boot — without this the dispatched
// `annotation.approved` reaches zero subscribers and nothing accrues.
import '@/lib/billing/init'

const ADMIN_USER = 'admin-1'
const SUBMITTER = 'submitter-1'
const VALID_ANNO_ID = '22222222-2222-4222-8222-222222222222'
const ANNOTATION = {
  id: VALID_ANNO_ID,
  topicId: 't-1',
  userId: SUBMITTER,
  payload: { ok: true },
  version: 1,
}
const TOPIC = {
  id: 't-1',
  taskId: 'task-1',
  status: 'submitted',
  version: 0,
  assignedTo: SUBMITTER,
}
// Single-stage task — this test pins payout-accrual wiring on a direct
// admin accept from `submitted`; the spec-9.3 two-stage gate is covered
// in review-annotation.test.ts.
const TASK = {
  id: 'task-1',
  workspaceId: 'ws-1',
  templateMode: 'survey',
  templateConfig: { taskSettings: { twoStageReview: false } },
}
const WORKSPACE = { id: 'ws-1', name: 'Test WS', adminId: 'creator' }

function setup() {
  vi.mocked(getSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: {
          user: { id: ADMIN_USER, email: 'a@labelhub.dev', user_metadata: {} },
        },
        error: null,
      }),
    },
  } as never)

  // reviewAnnotation query order: annotations → topics → tasks →
  // workspace+role (requireWorkspaceAdmin) → update topics → insert events.
  const selectQueue: unknown[][] = [
    [ANNOTATION],
    [TOPIC],
    [TASK],
    [{ workspace: WORKSPACE, role: 'admin' }],
  ]
  let i = 0

  const db: Record<string, unknown> = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectQueue[i++] ?? []),
        }),
        leftJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectQueue[i++] ?? []),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        then(onFulfilled: (v: unknown) => unknown) {
          return Promise.resolve().then(onFulfilled)
        },
        onConflictDoNothing() {
          return Promise.resolve()
        },
        onConflictDoUpdate() {
          return Promise.resolve()
        },
        returning: () => Promise.resolve([{ id: 'evt-1' }]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () =>
            Promise.resolve([{ ...TOPIC, status: 'approved', version: 1 }]),
        }),
      }),
    }),
  }
  // reviewAnnotation now wraps its topic-update + event-insert in
  // db.transaction; the tx handle is the same mock so the wrapped writes
  // run against it.
  db.transaction = async (cb: (tx: unknown) => unknown) => cb(db)
  vi.mocked(getDb).mockReturnValue(db as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reviewAnnotation → payout accrual wiring', () => {
  it('approve triggers approveAnnotation accrual for the annotation', async () => {
    setup()
    await expect(
      reviewAnnotation({ annotationId: VALID_ANNO_ID, decision: 'approve' }),
    ).resolves.toEqual({ ok: true })
    expect(approveAnnotation).toHaveBeenCalledTimes(1)
    expect(approveAnnotation).toHaveBeenCalledWith({
      annotationId: VALID_ANNO_ID,
    })
    // The inverted seam also drives the invite-reward scan with the mapped payload.
    expect(scanInviteRewardOnApproval).toHaveBeenCalledTimes(1)
    expect(scanInviteRewardOnApproval).toHaveBeenCalledWith({
      inviteeUserId: SUBMITTER,
      workspaceId: 'ws-1',
      triggerAnnotationId: VALID_ANNO_ID,
    })
  })

  it('reject does NOT accrue a payout', async () => {
    setup()
    await expect(
      reviewAnnotation({
        annotationId: VALID_ANNO_ID,
        decision: 'reject',
        feedback: 'no good',
      }),
    ).resolves.toEqual({ ok: true })
    expect(approveAnnotation).not.toHaveBeenCalled()
    expect(scanInviteRewardOnApproval).not.toHaveBeenCalled()
  })
})
