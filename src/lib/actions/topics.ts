'use server'
import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { tasks, topics, events } from '@/lib/db/schema'
import { requireUser, requireWorkspaceAdmin } from '@/lib/auth/guards'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors'
import { getTemplate } from '@/lib/templates/registry'
import { getEffectiveTemplate } from '@/lib/templates/effective'
import '@/lib/templates/init'
import type { TemplateMode } from '@/lib/templates/types'
import { uuidLike } from '@/lib/validators/uuid'
import { estimateDifficulty } from '@/lib/ai/difficulty-estimator'
import { logAICall } from '@/lib/ai/quota'

/**
 * Topic Server Actions.
 *
 * Authorization model:
 *   - createTopic: workspace admin only
 *   - claimTopic: any authenticated user (annotator), atomic race-safe via WHERE assignedTo IS NULL
 *   - releaseTopic: current claimer OR workspace admin
 */

const createTopicSchema = z.object({
  taskId: uuidLike,
  /** Validated against template.itemSchema (template-specific) — accept arbitrary object here */
  itemData: z.record(z.string(), z.unknown()),
  /**
   * When true, after the topic row lands we synchronously call the AI
   * difficulty estimator (a fast-tier Claude call) and persist the
   * 1-5 score + reasoning. Failures degrade silently — the topic still
   * gets created with NULL difficulty.
   *
   * Optional + default false so legacy / programmatic callers don't
   * get surprised by an extra LLM call. The admin UI surfaces a
   * "🪄 auto-estimate difficulty" checkbox that toggles this.
   */
  autoEstimateDifficulty: z.boolean().optional(),
})

const createTopicsBatchSchema = z.object({
  taskId: uuidLike,
  /** Up to 100 items per call. Each is validated against template.itemSchema. */
  items: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(100),
  /** Same semantics as createTopicSchema.autoEstimateDifficulty, but
   *  applied to EVERY row in the batch. For large batches admins may
   *  want to skip and run estimation later via a separate action. */
  autoEstimateDifficulty: z.boolean().optional(),
})

export interface CreateTopicsBatchResult {
  created: number
  failed: Array<{ index: number; error: string }>
}

export async function createTopic(input: z.infer<typeof createTopicSchema>) {
  const parsed = createTopicSchema.parse(input)
  const db = getDb()

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, parsed.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const { user } = await requireWorkspaceAdmin(task.workspaceId)

  // Template-specific schema validation.
  const template = getTemplate(task.templateMode as TemplateMode)
  if (!template) throw new ValidationError('Template not registered.')
  const validatedItem = template.itemSchema.parse(parsed.itemData)

  const [topic] = await db
    .insert(topics)
    .values({
      taskId: parsed.taskId,
      itemData: validatedItem,
      status: 'drafting',
    })
    .returning()

  await db.insert(events).values({
    type: 'topic.created',
    workspaceId: task.workspaceId,
    actorId: user.id,
    payload: { topicId: topic.id, taskId: task.id },
  })

  // Optional AI difficulty estimation. Runs after insert so the topic
  // is durable even if the AI call hangs or errors. Failures are
  // logged but never rethrown — the topic still gets created (just
  // with NULL difficulty, paying the 1.0× baseline multiplier).
  if (parsed.autoEstimateDifficulty) {
    const estimated = await tryEstimateDifficulty({
      mode: task.templateMode,
      templateConfig: task.templateConfig,
      itemData: validatedItem as Record<string, unknown>,
      userId: user.id,
      workspaceId: task.workspaceId,
    })
    if (estimated) {
      await db
        .update(topics)
        .set({
          difficulty: estimated.difficulty,
          difficultyReason: estimated.reasoning,
          difficultyAt: new Date(),
        })
        .where(eq(topics.id, topic.id))
      // Reflect the change in the returned row so callers don't need
      // a re-fetch.
      topic.difficulty = estimated.difficulty
      topic.difficultyReason = estimated.reasoning
      topic.difficultyAt = new Date()
    }
  }

  return topic
}

/**
 * Run the AI difficulty estimator on a topic's item data + rubric.
 * Pure wrapper — extracts the prompt/responseA/responseB envelope
 * shared by pair-rubric and arena-gsb, builds the rubric JSON, calls
 * the model, logs the AI call. Returns null when the topic shape
 * doesn't match (e.g. agent-trace-eval, which we skip for v1) OR when
 * the AI call fails (caller sees null and skips persistence).
 *
 * Centralized here so both createTopic and createTopicsBatch share the
 * exact same logic — including the failure-soft semantics.
 */
async function tryEstimateDifficulty(opts: {
  mode: string
  templateConfig: unknown
  itemData: Record<string, unknown>
  userId: string
  workspaceId: string
}): Promise<{ difficulty: number; reasoning: string } | null> {
  // v1 scope: only pair-rubric + arena-gsb have prompt/A/B envelopes
  // the estimator was trained on. Trajectory mode would need a
  // different prompt and is out of scope until we ship trajectory
  // difficulty.
  if (opts.mode !== 'pair-rubric' && opts.mode !== 'arena-gsb') return null

  const template = getEffectiveTemplate(opts.mode, opts.templateConfig)
  if (!template) return null
  const rubricItems =
    opts.mode === 'pair-rubric'
      ? template.pairChecklist ?? []
      : template.arenaDimensions ?? []
  // Strip the runtime-only `showWhen` for clarity in the prompt; the
  // estimator doesn't care about conditional logic when judging
  // difficulty, only about which dimensions will be scored.
  const compactRubric = rubricItems.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
  }))

  // Coerce the envelope. Same tolerance as the AI predicheck — empty
  // strings on missing fields rather than failing.
  const item = opts.itemData as {
    prompt?: unknown
    responseA?: { content?: unknown }
    responseB?: { content?: unknown }
  }
  const prompt = typeof item.prompt === 'string' ? item.prompt : ''
  const responseA =
    typeof item.responseA?.content === 'string' ? item.responseA.content : ''
  const responseB =
    typeof item.responseB?.content === 'string' ? item.responseB.content : ''

  try {
    const { estimate, usage } = await estimateDifficulty({
      mode: opts.mode,
      prompt,
      responseA,
      responseB,
      rubricJson: JSON.stringify(compactRubric),
    })
    await logAICall({
      userId: opts.userId,
      feature: 'difficulty-estimator',
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      workspaceId: opts.workspaceId,
    })
    return {
      difficulty: estimate.difficulty,
      reasoning: estimate.reasoning,
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[topics] difficulty estimation skipped:',
      e instanceof Error ? e.message : e,
    )
    return null
  }
}

/**
 * Bulk-create topics from an array of item payloads.
 *
 * Used by the admin "paste JSON" / "upload CSV" surface. Each item is
 * validated against the template's itemSchema individually so a single
 * bad row doesn't kill the rest — we report per-index errors and commit
 * the good rows.
 *
 * Auth: workspace admin only (same gate as createTopic). Returns a
 * summary the UI can render row-by-row.
 */
export async function createTopicsBatch(
  input: z.infer<typeof createTopicsBatchSchema>,
): Promise<CreateTopicsBatchResult> {
  const parsed = createTopicsBatchSchema.parse(input)
  const db = getDb()

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, parsed.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const { user } = await requireWorkspaceAdmin(task.workspaceId)

  const template = getTemplate(task.templateMode as TemplateMode)
  if (!template) throw new ValidationError('Template not registered.')

  const failed: Array<{ index: number; error: string }> = []
  const toInsert: Array<{ taskId: string; itemData: unknown; status: 'drafting' }> = []

  for (let i = 0; i < parsed.items.length; i++) {
    const item = parsed.items[i]
    try {
      const validated = template.itemSchema.parse(item)
      toInsert.push({
        taskId: parsed.taskId,
        itemData: validated,
        status: 'drafting',
      })
    } catch (e) {
      const msg =
        e instanceof z.ZodError
          ? e.issues.map((x) => `${x.path.join('.') || 'item'}: ${x.message}`).join('; ')
          : e instanceof Error
            ? e.message
            : 'unknown validation error'
      failed.push({ index: i, error: msg })
    }
  }

  if (toInsert.length === 0) {
    return { created: 0, failed }
  }

  // Single batched INSERT for the valid rows. drizzle's `.values(array)`
  // generates one statement so this is one round-trip even for 100 rows.
  const inserted = await db.insert(topics).values(toInsert).returning({
    id: topics.id,
  })

  // One event per topic so the audit log reflects the right granularity.
  await db.insert(events).values(
    inserted.map((row) => ({
      type: 'topic.created',
      workspaceId: task.workspaceId,
      actorId: user.id,
      payload: { topicId: row.id, taskId: task.id, viaBatch: true },
    })),
  )

  // Optional difficulty estimation per row. We deliberately do this
  // sequentially (one AI call at a time) rather than fan-out parallel
  // — keeps the daily quota check honest and avoids hammering the
  // upstream provider. For a 100-row batch this can take ~3-5 minutes;
  // an async/background mode is a future refinement.
  if (parsed.autoEstimateDifficulty && inserted.length > 0) {
    for (let i = 0; i < inserted.length; i++) {
      const row = inserted[i]
      // Map the insert-row back to the validated item by index — they
      // were appended in lockstep above.
      const item = toInsert[i].itemData as Record<string, unknown>
      const est = await tryEstimateDifficulty({
        mode: task.templateMode,
        templateConfig: task.templateConfig,
        itemData: item,
        userId: user.id,
        workspaceId: task.workspaceId,
      })
      if (est) {
        await db
          .update(topics)
          .set({
            difficulty: est.difficulty,
            difficultyReason: est.reasoning,
            difficultyAt: new Date(),
          })
          .where(eq(topics.id, row.id))
      }
    }
  }

  return { created: inserted.length, failed }
}

const topicIdSchema = z.object({ topicId: uuidLike })

/**
 * Claim a topic for the current user.
 *
 * Race-safe: the WHERE clause `assignedTo IS NULL` guarantees only one
 * caller wins — Postgres serializes the conditional update.
 */
export async function claimTopic(input: z.infer<typeof topicIdSchema>) {
  const parsed = topicIdSchema.parse(input)
  const user = await requireUser()
  const db = getDb()

  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, parsed.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  if (task.status !== 'open') {
    throw new ConflictError(
      `Task is ${task.status} — topics cannot be claimed.`,
    )
  }

  const updated = await db
    .update(topics)
    .set({ assignedTo: user.id, version: topic.version + 1 })
    .where(and(eq(topics.id, parsed.topicId), isNull(topics.assignedTo)))
    .returning()

  if (updated.length === 0) {
    throw new ConflictError('Topic already claimed by another annotator.')
  }

  await db.insert(events).values({
    type: 'topic.claimed',
    workspaceId: task.workspaceId,
    actorId: user.id,
    payload: { topicId: topic.id, taskId: task.id },
  })

  return updated[0]
}

/**
 * Release a topic (give up the claim).
 * Authorization: current claimer OR workspace admin.
 */
export async function releaseTopic(input: z.infer<typeof topicIdSchema>) {
  const parsed = topicIdSchema.parse(input)
  const user = await requireUser()
  const db = getDb()

  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, parsed.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const isClaimer = topic.assignedTo === user.id
  let isAdmin = false
  if (!isClaimer) {
    try {
      await requireWorkspaceAdmin(task.workspaceId)
      isAdmin = true
    } catch {
      // Not admin — fall through to ForbiddenError below.
    }
  }
  if (!isClaimer && !isAdmin) {
    throw new ForbiddenError('Not your topic to release.')
  }

  // Optimistic lock: only update if version still matches
  const updated = await db
    .update(topics)
    .set({
      assignedTo: null,
      status: 'drafting',
      version: topic.version + 1,
    })
    .where(and(eq(topics.id, topic.id), eq(topics.version, topic.version)))
    .returning()

  if (updated.length === 0) {
    throw new ConflictError(
      'Topic was modified concurrently — refresh and try again.',
    )
  }

  await db.insert(events).values({
    type: 'topic.released',
    workspaceId: task.workspaceId,
    actorId: user.id,
    payload: { topicId: topic.id, byAdmin: isAdmin },
  })

  return { ok: true as const }
}
