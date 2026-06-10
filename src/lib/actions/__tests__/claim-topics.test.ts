import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}))
vi.mock('@/lib/auth/guards', () => ({
  requireUser: vi.fn(),
  requireWorkspaceAdmin: vi.fn(),
}))
vi.mock('@/lib/tasks/quota', () => ({
  assertWithinClaimQuota: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))
// init pulls in the template registry side-effects; stub to a no-op so the
// 'use server' module loads without dragging in the whole registry.
vi.mock('@/lib/templates/init', () => ({}))

import { claimTopics } from '../topics'
import { getDb } from '@/lib/db/client'
import { requireUser } from '@/lib/auth/guards'
import { assertWithinClaimQuota } from '@/lib/tasks/quota'
import { ConflictError } from '@/lib/errors'

/**
 * `claimTopics` — bulk-claim (spec §4.3 任务广场).
 *
 * Contract under test:
 *   - Zod gate: 1..50 uuid ids, de-duped.
 *   - Reuses the same per-topic primitives as claimTopic: task.status
 *     === 'open' gate + assertWithinClaimQuota + atomic CAS claim.
 *   - Skip-and-continue: a topic that lost the CAS race, hit quota, or
 *     whose task isn't open is recorded in `skipped`; the rest proceed.
 */

const USER = { id: 'user-1', email: 'u@labelhub.dev' }
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

const TASK = {
  id: 'task-1',
  workspaceId: 'ws-1',
  templateMode: 'pair-rubric',
  templateConfig: {},
  status: 'open' as string,
}

/**
 * Per-topic scripting. For each topic id we define what the two select()
 * chains return (topic row, task row) and whether the claim CAS update
 * "wins" (returns a row) or "loses" (returns []).
 */
type TopicScript = {
  topic: {
    id: string
    taskId: string
    version: number
    assignedTo: string | null
    status: string
  } | null
  task: typeof TASK | null
  claimWins: boolean
}

function setupDb(scriptByOrder: TopicScript[]) {
  // The action runs sequentially per id and short-circuits with
  // `continue` at several points, so a phase toggle is fragile. Instead
  // we pre-flatten the exact sequence of select() results the control
  // flow will request, and a separate ordered list of update() results.
  //
  //   - missing topic  → 1 select result (empty), no task select, no update
  //   - present topic  → select(topic), select(task), then (if open +
  //                       quota) an update().returning()
  //
  // Quota rejection happens BEFORE the update (mocked separately in the
  // test), so for an over-quota row we still queue topic+task selects but
  // NO update result. We can't know here which rows the quota mock
  // rejects, so update results are queued for EVERY present+open row and
  // consumed only when the action actually reaches the CAS — the quota
  // test below scripts claimWins on the row it expects to reach the CAS.
  const selectResults: unknown[][] = []
  const updateResults: unknown[][] = []
  for (const s of scriptByOrder) {
    if (!s.topic) {
      selectResults.push([]) // topic select → empty, action continues
      continue
    }
    selectResults.push([s.topic]) // topic select
    selectResults.push(s.task ? [s.task] : []) // task select
    updateResults.push(s.claimWins ? [{ id: s.topic.id }] : [])
  }
  let selectIdx = 0
  let updateIdx = 0

  vi.mocked(getDb).mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectResults[selectIdx++] ?? []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updateResults[updateIdx++] ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: () => Promise.resolve(),
    }),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue(USER as never)
  vi.mocked(assertWithinClaimQuota).mockResolvedValue(undefined as never)
})

describe('claimTopics — validation', () => {
  it('rejects an empty list via Zod', async () => {
    await expect(claimTopics({ topicIds: [] })).rejects.toThrow()
  })

  it('rejects more than 50 ids', async () => {
    const ids = Array.from(
      { length: 51 },
      (_, i) => `${i.toString().padStart(8, '0')}-1111-4111-8111-111111111111`,
    )
    await expect(claimTopics({ topicIds: ids })).rejects.toThrow()
  })

  it('rejects invalid uuid shapes', async () => {
    await expect(claimTopics({ topicIds: ['not-a-uuid'] })).rejects.toThrow()
  })
})

describe('claimTopics — claim loop', () => {
  it('claims all open, unassigned topics', async () => {
    setupDb([
      { topic: { id: A, taskId: TASK.id, version: 0, assignedTo: null, status: 'drafting' }, task: TASK, claimWins: true },
      { topic: { id: B, taskId: TASK.id, version: 0, assignedTo: null, status: 'drafting' }, task: TASK, claimWins: true },
    ])
    const res = await claimTopics({ topicIds: [A, B] })
    expect(res.claimed).toEqual([A, B])
    expect(res.skipped).toEqual([])
  })

  it('skips a topic that lost the CAS race (already claimed)', async () => {
    setupDb([
      { topic: { id: A, taskId: TASK.id, version: 0, assignedTo: null, status: 'drafting' }, task: TASK, claimWins: true },
      { topic: { id: B, taskId: TASK.id, version: 0, assignedTo: null, status: 'drafting' }, task: TASK, claimWins: false },
    ])
    const res = await claimTopics({ topicIds: [A, B] })
    expect(res.claimed).toEqual([A])
    expect(res.skipped).toEqual([
      { topicId: B, reason: 'Already claimed by another annotator.' },
    ])
  })

  it('skips topics whose task is not open', async () => {
    setupDb([
      { topic: { id: A, taskId: TASK.id, version: 0, assignedTo: null, status: 'drafting' }, task: { ...TASK, status: 'paused' }, claimWins: true },
    ])
    const res = await claimTopics({ topicIds: [A] })
    expect(res.claimed).toEqual([])
    expect(res.skipped[0].topicId).toBe(A)
    expect(res.skipped[0].reason).toMatch(/paused/)
  })

  it('skips a missing topic', async () => {
    setupDb([{ topic: null, task: null, claimWins: false }])
    const res = await claimTopics({ topicIds: [A] })
    expect(res.claimed).toEqual([])
    expect(res.skipped).toEqual([
      { topicId: A, reason: 'Topic no longer exists.' },
    ])
  })

  it('re-checks quota per topic and skips when over quota', async () => {
    // First topic passes quota + claims; second hits quota and is skipped.
    vi.mocked(assertWithinClaimQuota)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(
        new ConflictError("You've reached your quota of 1 topic(s) for this task."),
      )
    setupDb([
      { topic: { id: A, taskId: TASK.id, version: 0, assignedTo: null, status: 'drafting' }, task: TASK, claimWins: true },
      { topic: { id: B, taskId: TASK.id, version: 0, assignedTo: null, status: 'drafting' }, task: TASK, claimWins: true },
    ])
    const res = await claimTopics({ topicIds: [A, B] })
    expect(res.claimed).toEqual([A])
    expect(res.skipped[0].topicId).toBe(B)
    expect(res.skipped[0].reason).toMatch(/quota/i)
  })

  it('de-dups a repeated id so it only claims once', async () => {
    setupDb([
      { topic: { id: A, taskId: TASK.id, version: 0, assignedTo: null, status: 'drafting' }, task: TASK, claimWins: true },
    ])
    const res = await claimTopics({ topicIds: [A, A] })
    expect(res.claimed).toEqual([A])
    expect(res.skipped).toEqual([])
  })

  it('partial batch: claims some, skips others, returns both lists', async () => {
    setupDb([
      { topic: { id: A, taskId: TASK.id, version: 0, assignedTo: null, status: 'drafting' }, task: TASK, claimWins: true },
      { topic: null, task: null, claimWins: false },
      { topic: { id: C, taskId: TASK.id, version: 0, assignedTo: null, status: 'drafting' }, task: TASK, claimWins: false },
    ])
    const res = await claimTopics({ topicIds: [A, B, C] })
    expect(res.claimed).toEqual([A])
    expect(res.skipped.map((s) => s.topicId)).toEqual([B, C])
  })
})
