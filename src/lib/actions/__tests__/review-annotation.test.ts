import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
}))
vi.mock('@/lib/webhooks/fanout', () => ({
  fanoutWebhook: vi.fn(async () => undefined),
}))
vi.mock('next/server', () => ({
  after: vi.fn((fn: () => unknown) => {
    void fn
  }),
}))
// 3rd-audit follow-up: reviewAnnotation now calls revalidatePath for
// admin + /my/* paths after the verdict commits. Stub it — the real
// implementation needs a static-generation store vitest doesn't have.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { reviewAnnotation, respondToReview } from '../annotations'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors'
import { getDb } from '@/lib/db/client'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * reviewAnnotation — the admin's FINAL acceptance step.
 *
 * Authoritative rules under test (docs/ROLE_PERMISSIONS.md):
 *   1. Only admin role passes (`requireWorkspaceAdmin`). qc / annotator
 *      / viewer get ForbiddenError.
 *   2. Allowed source states: `submitted`, `reviewing`,
 *      `awaiting_acceptance`. Admin can skip the QC step (acting on
 *      submitted/reviewing) or take the normal acceptance path (acting
 *      on awaiting_acceptance after QC passed).
 *   3. Transitions:
 *        approve          → 'approved'  (terminal)
 *        reject           → 'rejected'  (terminal)
 *        request_revision → 'revising'  (back to annotator)
 */

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

/**
 * Build the task row with a chosen review policy. These transition-
 * mechanics tests predate spec-9.3 two-stage review and assert the
 * single-stage direct-accept path, so they run with twoStage:false.
 * The two-stage gate has its own dedicated describe below.
 */
function taskWithPolicy(twoStage: boolean) {
  return {
    ...TASK,
    templateConfig: { taskSettings: { twoStageReview: twoStage } },
  }
}

const WORKSPACE = {
  id: 'ws-1',
  name: 'Test WS',
  adminId: 'creator',
}

function setupScenario(opts: {
  userId: string
  topicStatus: typeof TOPIC_BASE.status
  /** Role on workspace_members; null = not a member */
  userRole: 'admin' | 'qc' | 'annotator' | 'viewer' | null
  /** Override workspace.adminId for legacy-fallback testing */
  workspaceAdminId?: string
  /** Force update.returning() to return [] */
  updateConflict?: boolean
  /** Per-task review policy. Defaults to single-stage (legacy behaviour). */
  twoStage?: boolean
}) {
  const topic = { ...TOPIC_BASE, status: opts.topicStatus }
  const workspace = {
    ...WORKSPACE,
    adminId: opts.workspaceAdminId ?? WORKSPACE.adminId,
  }

  vi.mocked(getSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: opts.userId,
            email: `${opts.userId}@labelhub.dev`,
            user_metadata: {},
          },
        },
        error: null,
      }),
    },
  } as never)

  // reviewAnnotation query sequence:
  //   1. select annotations
  //   2. select topics
  //   3. select tasks
  //   4. select workspace+role  (requireWorkspaceAdmin)
  //   5. update topics (returning)
  //   6. insert events
  const selectQueue: unknown[][] = [
    [ANNOTATION],
    [topic],
    [taskWithPolicy(opts.twoStage ?? false)],
    [{ workspace, role: opts.userRole }],
  ]
  let selectIdx = 0

  const updateReturning = opts.updateConflict
    ? []
    : [{ ...topic, status: 'approved', version: topic.version + 1 }]

  const db: Record<string, unknown> = {
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
      values: () => {
        return {
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
        }
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updateReturning),
        }),
      }),
    }),
  }
  // reviewAnnotation now wraps the topic-update + event-insert in
  // db.transaction; pass the same mock as the tx handle.
  db.transaction = async (cb: (tx: unknown) => unknown) => cb(db)
  vi.mocked(getDb).mockReturnValue(db as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Role gate ───────────────────────────────────────────────────────────

describe('reviewAnnotation — role gate', () => {
  // Only admin passes. The matrix is unforgiving — qc cannot accept.
  it.each([
    ['admin' as const, true],
    ['qc' as const, false],
    ['annotator' as const, false],
    ['viewer' as const, false],
    [null, false],
  ])('userRole=%s → allowed=%s', async (role, allowed) => {
    setupScenario({
      userId: ADMIN_USER,
      userRole: role,
      topicStatus: 'submitted',
    })

    if (allowed) {
      const result = await reviewAnnotation({
        annotationId: VALID_ANNO_ID,
        decision: 'approve',
      })
      expect(result).toEqual({ ok: true })
    } else {
      await expect(
        reviewAnnotation({
          annotationId: VALID_ANNO_ID,
          decision: 'approve',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError)
    }
  })

  it('legacy fallback: workspace creator passes even without member row', async () => {
    setupScenario({
      userId: ADMIN_USER,
      userRole: null,
      topicStatus: 'submitted',
      workspaceAdminId: ADMIN_USER, // creator path
    })
    const result = await reviewAnnotation({
      annotationId: VALID_ANNO_ID,
      decision: 'approve',
    })
    expect(result).toEqual({ ok: true })
  })
})

// ─── Source-state matrix ─────────────────────────────────────────────────

describe('reviewAnnotation — source-state matrix', () => {
  const ALLOWED_STATES = ['submitted', 'reviewing', 'awaiting_acceptance'] as const
  const BLOCKED_STATES = ['drafting', 'revising', 'approved', 'rejected'] as const

  it.each(ALLOWED_STATES)('status=%s + decision=approve → ok', async (status) => {
    setupScenario({
      userId: ADMIN_USER,
      userRole: 'admin',
      topicStatus: status,
    })
    await expect(
      reviewAnnotation({
        annotationId: VALID_ANNO_ID,
        decision: 'approve',
      }),
    ).resolves.toEqual({ ok: true })
  })

  it.each(ALLOWED_STATES)('status=%s + decision=reject → ok', async (status) => {
    setupScenario({
      userId: ADMIN_USER,
      userRole: 'admin',
      topicStatus: status,
    })
    await expect(
      reviewAnnotation({
        annotationId: VALID_ANNO_ID,
        decision: 'reject',
        feedback: 'rejected — see notes',
      }),
    ).resolves.toEqual({ ok: true })
  })

  it.each(ALLOWED_STATES)(
    'status=%s + decision=request_revision → ok',
    async (status) => {
      setupScenario({
        userId: ADMIN_USER,
        userRole: 'admin',
        topicStatus: status,
      })
      await expect(
        reviewAnnotation({
          annotationId: VALID_ANNO_ID,
          decision: 'request_revision',
          feedback: 'please redo',
        }),
      ).resolves.toEqual({ ok: true })
    },
  )

  it('requires feedback when requesting a revision', async () => {
    setupScenario({
      userId: ADMIN_USER,
      userRole: 'admin',
      topicStatus: 'submitted',
    })
    await expect(
      reviewAnnotation({
        annotationId: VALID_ANNO_ID,
        decision: 'request_revision',
        feedback: '',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it.each(BLOCKED_STATES)(
    'status=%s → ConflictError (annotation past acceptance gate)',
    async (status) => {
      setupScenario({
        userId: ADMIN_USER,
        userRole: 'admin',
        topicStatus: status,
      })
      await expect(
        reviewAnnotation({
          annotationId: VALID_ANNO_ID,
          decision: 'approve',
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    },
  )
})

// ─── Two-stage review policy (spec 9.3) ───────────────────────────────────

describe('reviewAnnotation — two-stage review gate', () => {
  it.each(['submitted', 'reviewing'] as const)(
    'twoStage on: admin accept from %s is blocked (must pass QC 初审 first)',
    async (status) => {
      setupScenario({
        userId: ADMIN_USER,
        userRole: 'admin',
        topicStatus: status,
        twoStage: true,
      })
      await expect(
        reviewAnnotation({
          annotationId: VALID_ANNO_ID,
          decision: 'approve',
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    },
  )

  it('twoStage on: admin accept from awaiting_acceptance (终审) succeeds', async () => {
    setupScenario({
      userId: ADMIN_USER,
      userRole: 'admin',
      topicStatus: 'awaiting_acceptance',
      twoStage: true,
    })
    await expect(
      reviewAnnotation({
        annotationId: VALID_ANNO_ID,
        decision: 'approve',
      }),
    ).resolves.toEqual({ ok: true })
  })

  it('twoStage on: 打回 / reject from submitted is still allowed', async () => {
    setupScenario({
      userId: ADMIN_USER,
      userRole: 'admin',
      topicStatus: 'submitted',
      twoStage: true,
    })
    await expect(
      reviewAnnotation({
        annotationId: VALID_ANNO_ID,
        decision: 'reject',
        feedback: 'no good',
      }),
    ).resolves.toEqual({ ok: true })
  })
})

// ─── Optimistic locking ──────────────────────────────────────────────────

describe('reviewAnnotation — concurrency', () => {
  it('throws ConflictError when topic was modified between select and update', async () => {
    setupScenario({
      userId: ADMIN_USER,
      userRole: 'admin',
      topicStatus: 'submitted',
      updateConflict: true,
    })
    await expect(
      reviewAnnotation({
        annotationId: VALID_ANNO_ID,
        decision: 'approve',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

// ─── Resource resolution ─────────────────────────────────────────────────

describe('reviewAnnotation — resource resolution', () => {
  it('throws NotFoundError when annotation does not exist', async () => {
    vi.mocked(getSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: ADMIN_USER,
              email: 'a@labelhub.dev',
              user_metadata: {},
            },
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
          onConflictDoUpdate: () => Promise.resolve(),
        }),
      }),
    } as never)

    await expect(
      reviewAnnotation({
        annotationId: VALID_ANNO_ID,
        decision: 'approve',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ─── Input validation ────────────────────────────────────────────────────

describe('reviewAnnotation — input validation', () => {
  it('rejects unknown decision', async () => {
    setupScenario({
      userId: ADMIN_USER,
      userRole: 'admin',
      topicStatus: 'submitted',
    })
    await expect(
      reviewAnnotation({
        annotationId: VALID_ANNO_ID,
        // 'pass' is QC-only; admin's reviewAnnotation expects
        // approve/reject/request_revision. Schema rejects.
        // @ts-expect-error — testing schema rejection
        decision: 'pass',
      }),
    ).rejects.toThrow()
  })

  it('rejects bad UUID', async () => {
    setupScenario({
      userId: ADMIN_USER,
      userRole: 'admin',
      topicStatus: 'submitted',
    })
    await expect(
      reviewAnnotation({
        annotationId: 'not-a-uuid',
        decision: 'approve',
      }),
    ).rejects.toThrow()
  })
})

// ─── respondToReview — only the submitter can reply ─────────────────────

describe('respondToReview — author gate', () => {
  function setupReplyScenario(opts: {
    replierId: string
    annotationOwnerId: string
  }) {
    vi.mocked(getSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: opts.replierId,
              email: `${opts.replierId}@labelhub.dev`,
              user_metadata: {},
            },
          },
          error: null,
        }),
      },
    } as never)

    const selectQueue: unknown[][] = [
      [{ ...ANNOTATION, userId: opts.annotationOwnerId }],
      [{ ...TOPIC_BASE }],
      [TASK],
    ]
    let selectIdx = 0

    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectQueue[selectIdx++] ?? []),
          }),
        }),
      }),
      insert: () => ({
        values: () => {
          return {
            then(onFulfilled: (v: unknown) => unknown) {
              return Promise.resolve().then(onFulfilled)
            },
            onConflictDoNothing() {
              return Promise.resolve()
            },
            onConflictDoUpdate() {
              return Promise.resolve()
            },
            returning: () => Promise.resolve([{ id: 'evt-2' }]),
          }
        },
      }),
    } as never)
  }

  it('allows the original submitter to reply', async () => {
    setupReplyScenario({
      replierId: SUBMITTER,
      annotationOwnerId: SUBMITTER,
    })
    const result = await respondToReview({
      annotationId: VALID_ANNO_ID,
      message: 'thanks, I will revise',
    })
    expect(result).toEqual({ ok: true, eventId: 'evt-2' })
  })

  it('blocks an admin from replying as if they were the submitter', async () => {
    // The reply input is the SUBMITTER's voice — an admin can't ghost-write
    // a reply pretending to be the annotator. Admins should use the
    // verdict (reviewAnnotation) or feedback fields instead.
    setupReplyScenario({
      replierId: ADMIN_USER,
      annotationOwnerId: SUBMITTER,
    })
    await expect(
      respondToReview({
        annotationId: VALID_ANNO_ID,
        message: 'I am the admin, secretly replying',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects blank reply (whitespace-only)', async () => {
    setupReplyScenario({
      replierId: SUBMITTER,
      annotationOwnerId: SUBMITTER,
    })
    await expect(
      respondToReview({
        annotationId: VALID_ANNO_ID,
        message: '   ',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects empty reply at zod layer', async () => {
    setupReplyScenario({
      replierId: SUBMITTER,
      annotationOwnerId: SUBMITTER,
    })
    await expect(
      respondToReview({
        annotationId: VALID_ANNO_ID,
        message: '',
      }),
    ).rejects.toThrow()
  })
})
