import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
}))
vi.mock('next/server', () => ({
  after: vi.fn((fn: () => unknown) => {
    void fn
  }),
}))

import { saveDraftAnnotation } from '../annotations'
import {
  ConflictError,
  ForbiddenError,
} from '@/lib/errors'
import { getDb } from '@/lib/db/client'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * `saveDraftAnnotation` auto-claim path (Phase 2 / Phase 3 change).
 *
 * Until this session the function required the topic to already have
 * `assignedTo === user.id`. That made pair-rubric / arena-gsb topics
 * unworkable without admin pre-assignment. The new contract:
 *
 *   - topic.assignedTo === null    → auto-claim on first save
 *   - topic.assignedTo === user.id → save (existing behavior)
 *   - topic.assignedTo === other   → ForbiddenError
 *
 * Plus the upfront workspace-membership check via
 * `requireWorkspaceMember(task.workspaceId)` is still enforced.
 */

const USER = { id: 'user-1', email: 'u@labelhub.dev' }
const OTHER_USER = 'other-user'
const VALID_TOPIC = '11111111-1111-4111-8111-111111111111'

const TASK = {
  id: 'task-1',
  workspaceId: 'ws-1',
  templateMode: 'pair-rubric',
}

const WORKSPACE = {
  id: 'ws-1',
  name: 'WS',
  adminId: 'creator',
}

/**
 * Build a queueable DB mock that returns scripted rows from select()
 * chains and produces an updated-topic on the FIRST update() (claim)
 * + a successful annotation insert. The test cases below preload the
 * select queue with: [topic, task, workspace-member-row].
 */
function setupAuth(userId = USER.id, email = USER.email) {
  vi.mocked(getSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: {
          user: { id: userId, email, user_metadata: {} },
        },
        error: null,
      }),
    },
  } as never)
}

function setupDb(opts: {
  topic: {
    id: string
    taskId: string
    status: string
    version: number
    assignedTo: string | null
  } | null
  task: typeof TASK | null
  workspaceMemberRole: string | null
}) {
  const selectQueue: unknown[][] = [
    opts.topic ? [opts.topic] : [],
    opts.task ? [opts.task] : [],
    [{ workspace: WORKSPACE, role: opts.workspaceMemberRole }],
    // saveDraft re-queries annotations to find existing draft
    [],
  ]
  let selectIdx = 0

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
      values: () => {
        return {
          then(onFulfilled: (v: unknown) => unknown) {
            return Promise.resolve().then(onFulfilled)
          },
          onConflictDoNothing() {
            return Promise.resolve()
          },
          returning: () =>
            Promise.resolve([{ id: 'new-annotation' }]),
        }
      },
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  } as never)
}

beforeEach(() => vi.clearAllMocks())

describe('saveDraftAnnotation — auto-claim contract', () => {
  it('auto-claims an unassigned topic on first save (assignedTo=null → ok)', async () => {
    setupAuth()
    setupDb({
      topic: {
        id: VALID_TOPIC,
        taskId: TASK.id,
        status: 'drafting',
        version: 0,
        assignedTo: null,
      },
      task: TASK,
      workspaceMemberRole: 'annotator',
    })
    const result = await saveDraftAnnotation({
      topicId: VALID_TOPIC,
      payload: { ratings: { directly_answered: { a: true, b: false } } },
    })
    expect(result.id).toBe('new-annotation')
  })

  it('lets the existing claimant continue saving (assignedTo=me)', async () => {
    setupAuth()
    setupDb({
      topic: {
        id: VALID_TOPIC,
        taskId: TASK.id,
        status: 'drafting',
        version: 0,
        assignedTo: USER.id,
      },
      task: TASK,
      workspaceMemberRole: 'annotator',
    })
    const result = await saveDraftAnnotation({
      topicId: VALID_TOPIC,
      payload: { ratings: {} },
    })
    expect(result.id).toBe('new-annotation')
  })

  it('rejects another user when topic is already claimed (assignedTo=someone-else)', async () => {
    setupAuth()
    setupDb({
      topic: {
        id: VALID_TOPIC,
        taskId: TASK.id,
        status: 'drafting',
        version: 0,
        assignedTo: OTHER_USER,
      },
      task: TASK,
      workspaceMemberRole: 'annotator',
    })
    await expect(
      saveDraftAnnotation({ topicId: VALID_TOPIC, payload: {} }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects a non-member of the workspace (role=null on workspace_members)', async () => {
    setupAuth()
    setupDb({
      topic: {
        id: VALID_TOPIC,
        taskId: TASK.id,
        status: 'drafting',
        version: 0,
        assignedTo: null,
      },
      task: TASK,
      workspaceMemberRole: null,
    })
    await expect(
      saveDraftAnnotation({ topicId: VALID_TOPIC, payload: {} }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects when topic is in a non-drafting state (e.g. submitted)', async () => {
    setupAuth()
    setupDb({
      topic: {
        id: VALID_TOPIC,
        taskId: TASK.id,
        status: 'submitted',
        version: 0,
        assignedTo: USER.id,
      },
      task: TASK,
      workspaceMemberRole: 'annotator',
    })
    await expect(
      saveDraftAnnotation({ topicId: VALID_TOPIC, payload: {} }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('admin can also claim — auto-claim is not annotator-exclusive', async () => {
    setupAuth()
    setupDb({
      topic: {
        id: VALID_TOPIC,
        taskId: TASK.id,
        status: 'drafting',
        version: 0,
        assignedTo: null,
      },
      task: TASK,
      workspaceMemberRole: 'admin',
    })
    const result = await saveDraftAnnotation({
      topicId: VALID_TOPIC,
      payload: { ratings: {} },
    })
    expect(result.id).toBe('new-annotation')
  })
})
