import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}))
vi.mock('@/lib/ai/quota', () => ({
  assertWithinDailyAIQuota: vi.fn().mockResolvedValue(undefined),
  logAICall: vi.fn().mockResolvedValue(undefined),
}))
// Spread the real module (it re-exports reviewDimensionSchema +
// extractRubricJudgmentContext, which ai-agent-config-schema/ai-review-submission
// now pull in at load time) and override only the two run functions we stub.
vi.mock('@/lib/ai/review-agent', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/ai/review-agent')>()
  return {
    ...actual,
    runReviewAgentWithRetry: vi.fn(),
    runReviewAgentSelfConsistent: vi.fn(),
  }
})
vi.mock('@/lib/quality/annotation-revisions', () => ({
  writeRevision: vi.fn().mockResolvedValue({ revisionId: 'rev-1' }),
}))
vi.mock('@/lib/notifications/emit', () => ({
  emitNotification: vi.fn().mockResolvedValue(undefined),
}))

import {
  deleteVerdictForRerun,
  getLatestVerdict,
  scheduleAIReviewIfMissing,
} from '../ai-review-submission'
import {
  aiReviewConfigFingerprint,
  idempotencyKey,
} from '../ai-review-keys'
import { getDb } from '@/lib/db/client'
import {
  runReviewAgentWithRetry,
  runReviewAgentSelfConsistent,
} from '@/lib/ai/review-agent'
import { writeRevision } from '@/lib/quality/annotation-revisions'
import { emitNotification } from '@/lib/notifications/emit'
import { assertWithinDailyAIQuota } from '@/lib/ai/quota'

/**
 * AI Review Agent scheduler tests — Finals P2 D7.
 *
 * D7 ships the scheduler skeleton: the after-hook in submitAnnotation
 * inserts a pending row (or no-ops on idempotency conflict). The
 * actual Claude call comes in D8 — these tests cover the
 * after-window invariants:
 *
 *   - idempotencyKey: hash from (annotationId, judgeId, schemaVersion,
 *     configFingerprint, submissionVersion). A true double-fire of the SAME
 *     submission de-dups, but a resubmit after send_back (annotations.version
 *     bump) yields a fresh key so the AI RE-reviews the correction — the
 *     "AI 打回 → 改 → AI 重查" loop (spec §4.5).
 *   - scheduleAIReviewIfMissing:
 *       * inserts a `pending` row when no verdict exists
 *       * is a no-op when the task has aiAgent.enabled=false
 *       * defaults to enabled=true for custom-designer tasks
 *       * never throws — failures land in console.warn
 *   - getLatestVerdict / deleteVerdictForRerun shape contracts
 */

const ANNOTATION_ID = '11111111-1111-4111-8111-111111111111'
const TASK_ID = '22222222-2222-4222-8222-222222222222'
const PROMPT_TRACE = {
  system: 'system prompt trace',
  user: 'user prompt trace',
}

interface ScriptedDb {
  /** Queue of select() row arrays. */
  selectQueue: unknown[][]
  /** Last insert() call args, captured for assertions. */
  lastInsert?: { table: unknown; values: unknown }
  /** All insert() calls in order — useful for asserting event types. */
  inserts: Array<{ table: unknown; values: unknown }>
  /** All update() calls in order. */
  updates: Array<{ table: unknown; values: unknown }>
  /** Whether insert() should mimic an idempotency-conflict. */
  insertIsConflict: boolean
  /** Insert returns this row id when not in conflict. */
  insertReturningId: string
  /**
   * Rows update().returning() resolves to. Defaults to one row (the
   * conditional stage-advance found the topic still 'submitted'); set
   * to [] to script the lost-race path (a human reviewer moved the
   * topic first).
   */
  updateReturningRows: unknown[]
}

function makeDb(script: Partial<ScriptedDb> = {}): ScriptedDb {
  return {
    selectQueue: [],
    inserts: [],
    updates: [],
    insertIsConflict: false,
    insertReturningId: 'verdict-row-1',
    updateReturningRows: [{ id: 'topic-1' }],
    ...script,
  }
}

function mountDb(s: ScriptedDb) {
  let idx = 0
  const terminal = () => Promise.resolve(s.selectQueue[idx++] ?? [])
  const builder: unknown = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: terminal,
    then: (resolve: (rows: unknown[]) => void, reject?: (e: unknown) => void) =>
      terminal().then(resolve, reject),
  }
  vi.mocked(getDb).mockReturnValue({
    select: () => builder,
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        s.lastInsert = { table, values }
        s.inserts.push({ table, values })
        return {
          onConflictDoNothing: () => {
            const noConflict = !s.insertIsConflict
            const settled = Promise.resolve(
              noConflict ? [{ id: s.insertReturningId }] : [],
            )
            return Object.assign(settled, {
              returning: () =>
                noConflict
                  ? Promise.resolve([{ id: s.insertReturningId }])
                  : Promise.resolve([]),
            })
          },
        }
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => {
        s.updates.push({ table, values })
        return {
          where: () =>
            Object.assign(Promise.resolve([]), {
              returning: () => Promise.resolve(s.updateReturningRows),
            }),
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

  it('changes when the submission version changes (resubmit → AI re-review)', () => {
    const base = {
      annotationId: ANNOTATION_ID,
      judgeId: 'default',
      schemaVersion: 1,
      configFingerprint: 'fp-1',
    }
    const v1 = idempotencyKey({ ...base, submissionVersion: 1 })
    const v2 = idempotencyKey({ ...base, submissionVersion: 2 })
    // A resubmit (version bump) → fresh key → the AI grades the corrected work.
    expect(v1).not.toBe(v2)
    // The SAME submission version still de-dups a true double-fire.
    expect(idempotencyKey({ ...base, submissionVersion: 2 })).toBe(v2)
    // Omitting it (legacy callers) is stable and equals submissionVersion: 0.
    expect(idempotencyKey(base)).toBe(
      idempotencyKey({ ...base, submissionVersion: 0 }),
    )
  })

  it('changes when the effective AI review config fingerprint changes', () => {
    const strict = aiReviewConfigFingerprint({
      judgeId: 'default',
      schemaVersion: 1,
      promptTemplate: 'Be strict.',
      dimensions: [{ id: 'accuracy', name: 'Accuracy' }],
      passAt: 80,
      sendBackAt: 40,
      tier: 'fast',
      formSchemaId: 'schema-v1',
    })
    const lenient = aiReviewConfigFingerprint({
      judgeId: 'default',
      schemaVersion: 1,
      promptTemplate: 'Be lenient.',
      dimensions: [{ id: 'accuracy', name: 'Accuracy' }],
      passAt: 70,
      sendBackAt: 30,
      tier: 'fast',
      formSchemaId: 'schema-v1',
    })

    expect(strict).toMatch(/^[0-9a-f]{64}$/)
    expect(strict).not.toBe(lenient)
    expect(
      idempotencyKey({
        annotationId: ANNOTATION_ID,
        judgeId: 'default',
        schemaVersion: 1,
        configFingerprint: strict,
      }),
    ).not.toBe(
      idempotencyKey({
        annotationId: ANNOTATION_ID,
        judgeId: 'default',
        schemaVersion: 1,
        configFingerprint: lenient,
      }),
    )
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
    // The first insert is the pending verdict row; later inserts are
    // the ai_review.* event rows (D9 routing).
    const pendingInsert = s.inserts[0]
    expect(pendingInsert).toBeDefined()
    expect(
      (pendingInsert.values as { annotationId: string }).annotationId,
    ).toBe(ANNOTATION_ID)
    expect((pendingInsert.values as { status: string }).status).toBe('pending')
    expect(
      (pendingInsert.values as { idempotencyKey: string }).idempotencyKey,
    ).toMatch(/^[0-9a-f]{64}$/)
    expect((pendingInsert.values as { attempts: number }).attempts).toBe(0)
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
    const pendingInsert = s.inserts[0]
    expect(pendingInsert).toBeDefined()
    const fingerprint = aiReviewConfigFingerprint({
      judgeId: 'j-1',
      schemaVersion: 1,
      promptTemplate:
        'Review this annotation for completeness, accuracy, and adherence ' +
        'to the task instructions. Pass if it is publishable, send_back ' +
        'if it needs minor edits, human_review if it requires expert ' +
        'judgment.',
      dimensions: [
        { id: 'completeness', name: 'Completeness' },
        { id: 'accuracy', name: 'Accuracy' },
        { id: 'clarity', name: 'Clarity' },
      ],
      passAt: 70,
      sendBackAt: 40,
      tier: 'fast',
    })
    const expected = idempotencyKey({
      annotationId: ANNOTATION_ID,
      judgeId: 'j-1',
      schemaVersion: 1,
      configFingerprint: fingerprint,
    })
    expect(
      (pendingInsert.values as { idempotencyKey: string }).idempotencyKey,
    ).toBe(expected)
  })

  it('bakes owner prompt, dimensions, thresholds, tier, and form schema into the key', async () => {
    const config = {
      enabled: true,
      promptTemplate: 'Use the medical safety rubric.',
      dimensions: [
        {
          id: 'safety',
          name: 'Safety',
          description: 'No unsafe medical advice.',
        },
      ],
      passAt: 85,
      sendBackAt: 45,
      tier: 'premium' as const,
    }
    const s = makeDb({
      selectQueue: [
        [
          {
            annotationId: ANNOTATION_ID,
            taskId: TASK_ID,
            templateMode: 'custom-designer',
            templateConfig: { formSchemaId: 'schema-v7', aiAgent: config },
          },
        ],
        [{ version: 7 }],
      ],
    })
    mountDb(s)
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    const pendingInsert = s.inserts[0]
    const fingerprint = aiReviewConfigFingerprint({
      judgeId: 'default',
      schemaVersion: 7,
      promptTemplate: config.promptTemplate,
      dimensions: config.dimensions,
      passAt: config.passAt,
      sendBackAt: config.sendBackAt,
      tier: config.tier,
      formSchemaId: 'schema-v7',
    })

    expect(
      (pendingInsert.values as { idempotencyKey: string }).idempotencyKey,
    ).toBe(
      idempotencyKey({
        annotationId: ANNOTATION_ID,
        judgeId: 'default',
        schemaVersion: 7,
        configFingerprint: fingerprint,
      }),
    )
    const startedEvent = s.inserts.find(
      (insert) => (insert.values as { type?: string }).type === 'ai_review.started',
    )
    expect(
      (
        startedEvent?.values as {
          payload?: { configFingerprint?: string }
        }
      ).payload?.configFingerprint,
    ).toBe(fingerprint)
    expect(
      (
        startedEvent?.values as {
          payload?: { schemaVersion?: number; formSchemaId?: string }
        }
      ).payload,
    ).toMatchObject({ schemaVersion: 7, formSchemaId: 'schema-v7' })
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

/**
 * D9 — Verdict routing. The scheduler advances topic state + emits
 * events based on the agent verdict. These tests mock the LLM call
 * and assert the resulting writes.
 */
describe('verdict routing', () => {
  const TOPIC_ID = 'aaaa1111-1111-4111-8111-aaaaaaaaaaaa'
  const WORKSPACE_ID = 'bbbb2222-2222-4222-8222-bbbbbbbbbbbb'
  const SUBMITTER_ID = 'cccc3333-3333-4333-8333-cccccccccccc'

  function customDesignerRow() {
    return {
      annotationId: ANNOTATION_ID,
      annotationUserId: SUBMITTER_ID,
      annotationPayload: { answer: 'submitted text' },
      topicId: TOPIC_ID,
      taskId: TASK_ID,
      workspaceId: WORKSPACE_ID,
      templateMode: 'custom-designer',
      templateConfig: null,
      topicItemData: { prompt: 'How many?' },
    }
  }

  it("on pass: topic → 'reviewing'; events include started + completed(pass)", async () => {
    const s = makeDb({ selectQueue: [[customDesignerRow()]] })
    mountDb(s)
    vi.mocked(runReviewAgentWithRetry).mockResolvedValueOnce({
      payload: {
        verdict: 'pass',
        score: 88,
        dimensions: { completeness: 90 },
        reasoning: 'ok',
      },
      usage: { model: 'claude-haiku-4-5-20251001', inputTokens: 10, outputTokens: 5 },
      promptTrace: PROMPT_TRACE,
      attemptsUsed: 2,
    })
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })

    // topic transitioned twice: submitted→ai_review then ai_review→reviewing.
    // Filter by `version` bump (only topic rows get version bumps; verdict
    // rows don't).
    const topicUpdates = s.updates.filter(
      (u) => (u.values as { version?: unknown }).version !== undefined,
    )
    expect(
      topicUpdates.map((u) => (u.values as { status?: string }).status),
    ).toEqual(['ai_review', 'reviewing'])
    const verdictUpdate = s.updates.find(
      (u) => (u.values as { status?: string }).status === 'completed',
    )
    expect(
      (verdictUpdate?.values as { scores?: Record<string, unknown> }).scores
        ?.__score,
    ).toBe(88)
    expect(
      (
        (verdictUpdate?.values as { scores?: Record<string, unknown> }).scores
          ?.__rawPrompt as { user?: string } | undefined
      )?.user,
    ).toBe(PROMPT_TRACE.user)
    expect((verdictUpdate?.values as { attempts?: number }).attempts).toBe(2)

    const eventTypes = s.inserts
      .filter((i) => (i.values as { type?: string }).type?.startsWith('ai_review.'))
      .map((i) => (i.values as { type: string }).type)
    expect(eventTypes).toEqual(['ai_review.started', 'ai_review.completed'])
  })

  it('lost race: human reviewer moved the topic first → verdict closed, no started event, no LLM call', async () => {
    // updateReturningRows: [] scripts the conditional stage-advance
    // (submitted → ai_review) matching 0 rows — a reviewer beat the
    // after() window to this topic.
    const s = makeDb({
      selectQueue: [[customDesignerRow()]],
      updateReturningRows: [],
    })
    mountDb(s)
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })

    // No ai_review.* event may land — the transition never happened,
    // and a phantom 'ai_review.started' would corrupt the audit trail.
    const eventTypes = s.inserts
      .filter((i) =>
        (i.values as { type?: string }).type?.startsWith('ai_review.'),
      )
      .map((i) => (i.values as { type: string }).type)
    expect(eventTypes).toEqual([])

    // The pending verdict row is closed out, not left dangling.
    const verdictUpdate = s.updates.find(
      (u) => (u.values as { status?: string }).status === 'failed',
    )
    expect(verdictUpdate).toBeDefined()
    expect(
      (verdictUpdate?.values as { errorText?: string }).errorText,
    ).toContain('skipped')

    // And no model tokens are burned on a topic nobody is waiting on.
    expect(vi.mocked(runReviewAgentWithRetry)).not.toHaveBeenCalled()
    expect(vi.mocked(runReviewAgentSelfConsistent)).not.toHaveBeenCalled()
  })

  it('uses the self-consistency runner when samples > 1 and persists confidence', async () => {
    const row = {
      ...customDesignerRow(),
      templateConfig: { aiAgent: { enabled: true, samples: 3 } },
    }
    const s = makeDb({ selectQueue: [[row]] })
    mountDb(s)
    vi.mocked(runReviewAgentSelfConsistent).mockResolvedValueOnce({
      payload: { verdict: 'pass', score: 85, dimensions: { a: { score: 84, reasoning: 'r', evidence: [] } }, reasoning: 'ok' },
      usage: { model: 'claude-haiku-4-5-20251001', provider: 'anthropic', inputTokens: 30, outputTokens: 15, temperature: 0.5 },
      promptTrace: PROMPT_TRACE,
      attemptsUsed: 3,
      consistency: { samples: 3, agreement: 1, confidence: 95, sampleScores: [84, 85, 86], scoreStdDev: 0.8 },
    } as never)
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    // Routed to the self-consistency runner, NOT the single-shot path.
    expect(vi.mocked(runReviewAgentSelfConsistent)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runReviewAgentWithRetry)).not.toHaveBeenCalled()
    const verdictUpdate = s.updates.find(
      (u) => (u.values as { status?: string }).status === 'completed',
    )
    const scores = (verdictUpdate?.values as { scores?: Record<string, unknown> })
      .scores
    expect(scores?.__confidence).toBe(95)
    expect(scores?.__samples).toBe(3)
    expect(scores?.__model).toBe('claude-haiku-4-5-20251001')
  })

  it("on send_back: topic → 'drafting'; writeRevision called; sent_back event emitted", async () => {
    const s = makeDb({ selectQueue: [[customDesignerRow()]] })
    mountDb(s)
    vi.mocked(runReviewAgentWithRetry).mockResolvedValueOnce({
      payload: {
        verdict: 'send_back',
        score: 25,
        dimensions: { completeness: 30 },
        reasoning: 'incomplete',
      },
      usage: { model: 'claude-haiku-4-5-20251001', inputTokens: 10, outputTokens: 5 },
      promptTrace: PROMPT_TRACE,
    })
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })

    expect(vi.mocked(writeRevision)).toHaveBeenCalledWith(
      expect.objectContaining({
        annotationId: ANNOTATION_ID,
        kind: 'ai_send_back',
        actorId: SUBMITTER_ID,
      }),
    )
    const topicStatuses = s.updates
      .filter(
        (u) => (u.values as { version?: unknown }).version !== undefined,
      )
      .map((u) => (u.values as { status?: string }).status)
      .filter(Boolean)
    expect(topicStatuses).toEqual(['ai_review', 'drafting'])
    const eventTypes = s.inserts
      .filter((i) => (i.values as { type?: string }).type?.startsWith('ai_review.'))
      .map((i) => (i.values as { type: string }).type)
    expect(eventTypes).toEqual(['ai_review.started', 'ai_review.sent_back'])
  })

  it("on human_review: topic → 'reviewing'; verdict row gets a __priority flag", async () => {
    const s = makeDb({ selectQueue: [[customDesignerRow()]] })
    mountDb(s)
    vi.mocked(runReviewAgentWithRetry).mockResolvedValueOnce({
      payload: {
        verdict: 'human_review',
        score: 55,
        dimensions: { completeness: 55 },
        reasoning: 'borderline',
      },
      usage: { model: 'claude-haiku-4-5-20251001', inputTokens: 10, outputTokens: 5 },
      promptTrace: PROMPT_TRACE,
    })
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })

    const verdictUpdate = s.updates.find(
      (u) => (u.values as { scores?: Record<string, unknown> }).scores
        ?.__priority === true,
    )
    expect(verdictUpdate).toBeDefined()
    expect(
      (verdictUpdate?.values as { scores?: Record<string, unknown> }).scores
        ?.__score,
    ).toBe(55)
    expect(
      (
        (verdictUpdate?.values as { scores?: Record<string, unknown> }).scores
          ?.__rawPrompt as { system?: string } | undefined
      )?.system,
    ).toBe(PROMPT_TRACE.system)
    const topicStatuses = s.updates
      .filter(
        (u) => (u.values as { version?: unknown }).version !== undefined,
      )
      .map((u) => (u.values as { status?: string }).status)
      .filter(Boolean)
    expect(topicStatuses).toEqual(['ai_review', 'reviewing'])
  })

  it('on agent failure: emits ai_review.failed and rolls topic back to submitted', async () => {
    const s = makeDb({ selectQueue: [[customDesignerRow()]] })
    mountDb(s)
    vi.mocked(runReviewAgentWithRetry).mockRejectedValueOnce(
      new Error('LLM exploded'),
    )
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })

    const eventTypes = s.inserts
      .filter((i) => (i.values as { type?: string }).type?.startsWith('ai_review.'))
      .map((i) => (i.values as { type: string }).type)
    expect(eventTypes).toContain('ai_review.failed')
    // ai_review → submitted rollback. Find the LAST topic-table update
    // (topic rows have `version` bumps; verdict rows don't).
    const lastTopicStatus = [...s.updates]
      .reverse()
      .find((u) => (u.values as { version?: unknown }).version !== undefined)
    expect(
      (lastTopicStatus?.values as { status?: string }).status,
    ).toBe('submitted')
  })
})

/**
 * D13 — Notifications. The submitter's inbox gets a row whenever the
 * AI agent makes a non-trivial decision (send_back or human_review).
 * The pass case stays silent so we don't spam the labeler with
 * "your work passed" on every submit.
 */
describe('notification emission (D13)', () => {
  const TOPIC_ID = 'aaaa1111-1111-4111-8111-aaaaaaaaaaaa'
  const WORKSPACE_ID = 'bbbb2222-2222-4222-8222-bbbbbbbbbbbb'
  const SUBMITTER_ID = 'cccc3333-3333-4333-8333-cccccccccccc'

  function customDesignerRow() {
    return {
      annotationId: ANNOTATION_ID,
      annotationUserId: SUBMITTER_ID,
      annotationPayload: { answer: 'submitted text' },
      topicId: TOPIC_ID,
      taskId: TASK_ID,
      workspaceId: WORKSPACE_ID,
      templateMode: 'custom-designer',
      templateConfig: null,
      topicItemData: { prompt: 'How many?' },
    }
  }

  it('send_back emits an ai_review.sent_back notification to the submitter', async () => {
    const s = makeDb({ selectQueue: [[customDesignerRow()]] })
    mountDb(s)
    vi.mocked(runReviewAgentWithRetry).mockResolvedValueOnce({
      payload: {
        verdict: 'send_back',
        score: 22,
        dimensions: {},
        reasoning: 'Add more detail in section 2.',
      },
      usage: {
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 10,
        outputTokens: 5,
      },
      promptTrace: PROMPT_TRACE,
    })
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    expect(vi.mocked(emitNotification)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ai_review.sent_back',
        userId: SUBMITTER_ID,
        workspaceId: WORKSPACE_ID,
        linkUrl: `/workspaces/${WORKSPACE_ID}/topics/${TOPIC_ID}/annotate`,
      }),
    )
    const call = vi.mocked(emitNotification).mock.calls[0]?.[0]
    expect(call?.body).toContain('Add more detail')
  })

  it('human_review emits an ai_review.escalated notification', async () => {
    const s = makeDb({ selectQueue: [[customDesignerRow()]] })
    mountDb(s)
    vi.mocked(runReviewAgentWithRetry).mockResolvedValueOnce({
      payload: {
        verdict: 'human_review',
        score: 50,
        dimensions: {},
        reasoning: 'borderline',
      },
      usage: {
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 10,
        outputTokens: 5,
      },
      promptTrace: PROMPT_TRACE,
    })
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    expect(vi.mocked(emitNotification)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ai_review.escalated',
        userId: SUBMITTER_ID,
        workspaceId: WORKSPACE_ID,
        linkUrl: `/workspaces/${WORKSPACE_ID}/topics/${TOPIC_ID}/annotate`,
      }),
    )
  })

  it('pass does NOT emit any notification (silence is golden)', async () => {
    const s = makeDb({ selectQueue: [[customDesignerRow()]] })
    mountDb(s)
    vi.mocked(runReviewAgentWithRetry).mockResolvedValueOnce({
      payload: {
        verdict: 'pass',
        score: 92,
        dimensions: {},
        reasoning: 'looks good',
      },
      usage: {
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 10,
        outputTokens: 5,
      },
      promptTrace: PROMPT_TRACE,
    })
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    expect(vi.mocked(emitNotification)).not.toHaveBeenCalled()
  })

  it('agent failure does NOT emit a notification (admin sees the audit log)', async () => {
    const s = makeDb({ selectQueue: [[customDesignerRow()]] })
    mountDb(s)
    vi.mocked(runReviewAgentWithRetry).mockRejectedValueOnce(
      new Error('LLM exploded'),
    )
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    expect(vi.mocked(emitNotification)).not.toHaveBeenCalled()
  })
})

/**
 * D21-A — Quota-exhaustion rollback. Pre-D21 the scheduler set
 * verdict.status='failed' but RETURNED without rolling back the
 * topic, leaving it stuck in 'ai_review' forever. The fix mirrors
 * the LLM-failure path's rollback + adds a distinct event reason
 * so audit timelines can show "AI quota exhausted" vs "AI crashed".
 */
describe('quota-exhaustion rollback (D21-A)', () => {
  const TOPIC_ID = 'aaaa1111-1111-4111-8111-aaaaaaaaaaaa'
  const WORKSPACE_ID = 'bbbb2222-2222-4222-8222-bbbbbbbbbbbb'
  const SUBMITTER_ID = 'cccc3333-3333-4333-8333-cccccccccccc'

  function customDesignerRow() {
    return {
      annotationId: ANNOTATION_ID,
      annotationUserId: SUBMITTER_ID,
      annotationPayload: { answer: 'submitted text' },
      topicId: TOPIC_ID,
      taskId: TASK_ID,
      workspaceId: WORKSPACE_ID,
      templateMode: 'custom-designer',
      templateConfig: null,
      topicItemData: { prompt: 'How many?' },
    }
  }

  it('rolls topic back to submitted on quota error', async () => {
    const s = makeDb({ selectQueue: [[customDesignerRow()]] })
    mountDb(s)
    vi.mocked(assertWithinDailyAIQuota).mockRejectedValueOnce(
      new Error('Daily AI quota reached (100/100).'),
    )
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    // Topic transitions: submitted→ai_review (first update at the top
    // of the scheduler) then ai_review→submitted (rollback). Filter
    // topic updates (they bump version; verdict updates don't).
    const topicUpdates = s.updates.filter(
      (u) => (u.values as { version?: unknown }).version !== undefined,
    )
    const statuses = topicUpdates.map(
      (u) => (u.values as { status?: string }).status,
    )
    expect(statuses).toEqual(['ai_review', 'submitted'])
  })

  it('emits ai_review.failed with reason=quota_exhausted', async () => {
    const s = makeDb({ selectQueue: [[customDesignerRow()]] })
    mountDb(s)
    vi.mocked(assertWithinDailyAIQuota).mockRejectedValueOnce(
      new Error('Daily AI quota reached.'),
    )
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    const failedEvent = s.inserts.find(
      (i) => (i.values as { type?: string }).type === 'ai_review.failed',
    )
    expect(failedEvent).toBeDefined()
    expect(
      (failedEvent?.values as { payload?: { reason?: string } }).payload
        ?.reason,
    ).toBe('quota_exhausted')
  })

  it('agent runner is NOT invoked when quota is exhausted', async () => {
    const s = makeDb({ selectQueue: [[customDesignerRow()]] })
    mountDb(s)
    vi.mocked(assertWithinDailyAIQuota).mockRejectedValueOnce(
      new Error('Daily AI quota reached.'),
    )
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    expect(vi.mocked(runReviewAgentWithRetry)).not.toHaveBeenCalled()
  })

  it('does NOT fire a labeler notification on quota exhaustion (matches D13 silence policy)', async () => {
    const s = makeDb({ selectQueue: [[customDesignerRow()]] })
    mountDb(s)
    vi.mocked(assertWithinDailyAIQuota).mockRejectedValueOnce(
      new Error('Daily AI quota reached.'),
    )
    await scheduleAIReviewIfMissing({ annotationId: ANNOTATION_ID })
    expect(vi.mocked(emitNotification)).not.toHaveBeenCalled()
  })
})
