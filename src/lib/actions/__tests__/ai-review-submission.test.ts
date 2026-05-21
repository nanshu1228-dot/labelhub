import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}))

import {
  deleteVerdictForRerun,
  getLatestVerdict,
  scheduleAIReviewIfMissing,
} from '../ai-review-submission'
import { idempotencyKey } from '../ai-review-keys'
import { getDb } from '@/lib/db/client'

/**
 * AI Review Agent scheduler tests — Finals P2 D7.
 *
 * D7 ships the scheduler skeleton: the after-hook in submitAnnotation
 * inserts a pending row (or no-ops on idempotency conflict). The
 * actual Claude call comes in D8 — these tests cover the
 * after-window invariants:
 *
 *   - idempotencyKey: stable hash from (annotationId, judgeId,
 *     schemaVersion) so a re-submit doesn't re-enqueue
 *   - scheduleAIReviewIfMissing:
 *       * inserts a `pending` row when no verdict exists
 *       * is a no-op when the task has aiAgent.enabled=false
 *       * defaults to enabled=true for custom-designer tasks
 *       * never throws — failures land in console.warn
 *   - getLatestVerdict / deleteVerdictForRerun shape contracts
 */

const ANNOTATION_ID = '11111111-1111-4111-8111-111111111111'
const TASK_ID = '22222222-2222-4222-8222-222222222222'

interface ScriptedDb {
  /** Queue of select() row arrays. */
  selectQueue: unknown[][]
  /** Last insert() call args, captured for assertions. */
  lastInsert?: { table: unknown; values: unknown }
  /** Whether insert() should mimic an idempotency-conflict. */
  insertIsConflict: boolean
}

function makeDb(script: Partial<ScriptedDb> = {}): ScriptedDb {
  return {
    selectQueue: [],
    insertIsConflict: false,
    ...script,
  }
}

function mountDb(s: ScriptedDb) {
  let idx = 0
  // Drizzle query chains for our two callers:
  //   db.select(...).from(...).innerJoin(...).innerJoin(...).where(...).limit(1)
  //   db.select(...).from(...).where(...).orderBy(...)
  // The mock returns the same proxy from each builder step so every
  // chain shape is honored; the terminal Promise resolves with the
  // next queued row array.
  const terminal = () => Promise.resolve(s.selectQueue[idx++] ?? [])
  const builder: unknown = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: terminal,
    // Some Drizzle helpers await the builder directly without limit().
    then: (resolve: (rows: unknown[]) => void, reject?: (e: unknown) => void) =>
      terminal().then(resolve, reject),
  }
  vi.mocked(getDb).mockReturnValue({
    select: () => builder,
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        s.lastInsert = { table, values }
        return {
          onConflictDoNothing: () =>
            s.insertIsConflict ? Promise.resolve([]) : Promise.resolve([{}]),
        }
      },
    }),
    delete: () => ({
      where: () => Promise.resolve([]),
    }),
  } as unknown as ReturnType<typeof getDb>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('idempotencyKey', () => {
  it('returns a 64-char hex digest', () => {
    const k = idempotencyKey({
      annotationId: ANNOTATION_ID,
      judgeId: 'j-default',
      schemaVersion: 1,
    })
    expect(k).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns the same key for the same inputs', () => {
    const a = idempotencyKey({
      annotationId: ANNOTATION_ID,
      judgeId: 'j-1',
      schemaVersion: 2,
    })
    const b = idempotencyKey({
      annotationId: ANNOTATION_ID,
      judgeId: 'j-1',
      schemaVersion: 2,
    })
    expect(a).toBe(b)
  })

  it('returns a different key when any input changes', () => {
    const a = idempotencyKey({
      annotationId: ANNOTATION_ID,
      judgeId: 'j-1',
      schemaVersion: 1,
    })
    const b = idempotencyKey({
      annotationId: ANNOTATION_ID,
      judgeId: 'j-1',
      schemaVersion: 2,
    })
    const c = idempotencyKey({
      annotationId: ANNOTATION_ID,
      judgeId: 'j-other',
      schemaVersion: 1,
    })
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
    expect(b).not.toBe(c)
  })
})

describe('scheduleAIReviewIfMissing', () => {
  it('inserts a pending row for a custom-designer task by default', async () => {
    const s = makeDb({
      selectQueue: [
        [
          {
            annotationId: ANNOTATION_ID,
            taskId: TASK_ID,
            templateMode: 'custom-designer',
            templateConfig: null,
          },
        ],
      ],
    })
    mountDb(s)
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    expect(s.lastInsert).toBeDefined()
    expect((s.lastInsert?.values as { annotationId: string }).annotationId).toBe(
      ANNOTATION_ID,
    )
    expect((s.lastInsert?.values as { status: string }).status).toBe('pending')
    expect(
      (s.lastInsert?.values as { idempotencyKey: string }).idempotencyKey,
    ).toMatch(/^[0-9a-f]{64}$/)
    expect((s.lastInsert?.values as { attempts: number }).attempts).toBe(0)
  })

  it('does nothing when the task has aiAgent.enabled=false', async () => {
    const s = makeDb({
      selectQueue: [
        [
          {
            annotationId: ANNOTATION_ID,
            taskId: TASK_ID,
            templateMode: 'custom-designer',
            templateConfig: { aiAgent: { enabled: false } },
          },
        ],
      ],
    })
    mountDb(s)
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    expect(s.lastInsert).toBeUndefined()
  })

  it('does nothing for a pair-rubric task with no opt-in', async () => {
    const s = makeDb({
      selectQueue: [
        [
          {
            annotationId: ANNOTATION_ID,
            taskId: TASK_ID,
            templateMode: 'pair-rubric',
            templateConfig: null,
          },
        ],
      ],
    })
    mountDb(s)
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    expect(s.lastInsert).toBeUndefined()
  })

  it('inserts a pending row for a pair-rubric task when owner opts in', async () => {
    const s = makeDb({
      selectQueue: [
        [
          {
            annotationId: ANNOTATION_ID,
            taskId: TASK_ID,
            templateMode: 'pair-rubric',
            templateConfig: { aiAgent: { enabled: true, judgeId: 'j-1' } },
          },
        ],
      ],
    })
    mountDb(s)
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    expect(s.lastInsert).toBeDefined()
    // The judgeId from the config flows into the idempotency hash.
    const expected = idempotencyKey({
      annotationId: ANNOTATION_ID,
      judgeId: 'j-1',
      schemaVersion: 1,
    })
    expect(
      (s.lastInsert?.values as { idempotencyKey: string }).idempotencyKey,
    ).toBe(expected)
  })

  it('returns silently when the annotation is missing', async () => {
    const s = makeDb({ selectQueue: [[]] })
    mountDb(s)
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    expect(s.lastInsert).toBeUndefined()
  })

  // (The task-missing case is now covered by the empty-result branch
  // of the inner-join; removed since the join returns one row or none.)

  it('swallows downstream errors so the after() window stays clean', async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('boom — pretend DB exploded')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Must NOT throw — the after-hook isolation contract.
    await expect(
      scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID }),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('rejects a malformed annotationId via Zod', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await scheduleAIReviewIfMissing({ annotationId: 'not-a-uuid' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('getLatestVerdict / deleteVerdictForRerun', () => {
  it('getLatestVerdict returns null when no rows exist', async () => {
    const s = makeDb({ selectQueue: [[]] })
    mountDb(s)
    const v = await getLatestVerdict(ANNOTATION_ID)
    expect(v).toBeNull()
  })

  it('getLatestVerdict returns the most-recent row from an ordered list', async () => {
    const rows = [
      {
        id: 'v1',
        status: 'completed',
        verdict: 'pass',
        reasoning: 'first',
        scores: null,
        startedAt: new Date(1000),
        finishedAt: new Date(2000),
      },
      {
        id: 'v2',
        status: 'pending',
        verdict: null,
        reasoning: null,
        scores: null,
        startedAt: new Date(3000),
        finishedAt: null,
      },
    ]
    const s = makeDb({ selectQueue: [rows] })
    mountDb(s)
    const v = await getLatestVerdict(ANNOTATION_ID)
    // The function takes the LAST element of the ascending list (most recent).
    expect(v?.id).toBe('v2')
    expect(v?.status).toBe('pending')
  })

  it('deleteVerdictForRerun resolves without throwing', async () => {
    const s = makeDb({})
    mountDb(s)
    await expect(deleteVerdictForRerun(ANNOTATION_ID)).resolves.toBeUndefined()
  })
})
