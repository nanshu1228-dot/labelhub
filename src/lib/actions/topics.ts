'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNull } from 'drizzle-orm'
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
import { assertWithinClaimQuota } from '@/lib/tasks/quota'
import {
  applyTopicItemMergePatch,
  summarizeTopicPatchKeys,
  type JsonRecord,
} from '@/lib/topics/item-data-patch'

/**
 * Topic Server Actions.
 *
 * Authorization model:
 *   - createTopic: workspace admin only
 *   - claimTopic: any authenticated user (annotator), atomic race-safe via WHERE assignedTo IS NULL
 *   - releaseTopic: current claimer OR workspace admin
 */

// Per-item byte budget for topic itemData — 64KB covers a typical
// (prompt, responseA, responseB) row generously; anything larger is a
// malformed import. Matches the annotation-payload budget.
const TOPIC_ITEM_BYTE_BUDGET = 64_000
const itemDataShape = z
  .record(z.string(), z.unknown())
  .refine(
    (v) =>
      Buffer.byteLength(JSON.stringify(v ?? {}), 'utf8') <=
      TOPIC_ITEM_BYTE_BUDGET,
    {
      message: `itemData exceeds ${TOPIC_ITEM_BYTE_BUDGET / 1000}KB byte budget`,
    },
  )

const createTopicSchema = z.object({
  taskId: uuidLike,
  /** Validated against template.itemSchema (template-specific) — accept arbitrary object here */
  itemData: itemDataShape,
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
  items: z.array(itemDataShape).min(1).max(100),
  /**
   * Finals D21-C — optional per-row assignment. Length MUST match
   * items.length when present; each element is the user-id the
   * matching topic should be assignedTo (null = unassigned / open
   * queue). The import UI computes this via
   * `src/lib/import/distribution.ts` after the parser yields rows.
   */
  assignments: z
    .array(uuidLike.nullable())
    .optional(),
  /** Same semantics as createTopicSchema.autoEstimateDifficulty, but
   *  applied to EVERY row in the batch. For large batches admins may
   *  want to skip and run estimation later via a separate action. */
  autoEstimateDifficulty: z.boolean().optional(),
})

const batchPatchTopicItemDataSchema = z.object({
  taskId: uuidLike,
  topicIds: z.array(uuidLike).min(1).max(200),
  patch: itemDataShape,
})

export interface CreateTopicsBatchResult {
  created: number
  failed: Array<{ index: number; error: string }>
}

export interface BatchPatchTopicItemDataResult {
  updated: string[]
  skipped: Array<{ topicId: string; reason: string }>
  failed: Array<{ topicId: string; error: string }>
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

  revalidatePath(`/workspaces/${task.workspaceId}/tasks/${task.id}`)
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

  // D21-C — when assignments are present they must match items.
  if (
    parsed.assignments &&
    parsed.assignments.length !== parsed.items.length
  ) {
    throw new ValidationError(
      `assignments.length (${parsed.assignments.length}) must equal items.length (${parsed.items.length}).`,
    )
  }

  const failed: Array<{ index: number; error: string }> = []
  const toInsert: Array<{
    taskId: string
    itemData: unknown
    status: 'drafting'
    assignedTo: string | null
  }> = []

  for (let i = 0; i < parsed.items.length; i++) {
    const item = parsed.items[i]
    try {
      const validated = template.itemSchema.parse(item)
      toInsert.push({
        taskId: parsed.taskId,
        itemData: validated,
        status: 'drafting',
        assignedTo: parsed.assignments?.[i] ?? null,
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

  // Optional difficulty estimation per row. Sequential rather than
  // parallel — keeps daily quota accounting honest and avoids
  // hammering the upstream provider.
  //
  // Cap: AUTO_ESTIMATE_BATCH_CAP. Above this, we estimate the FIRST
  // N rows and leave the rest with null difficulty (admin can run a
  // separate re-estimate action later). Without this, a 100-row
  // bulk-upload with auto-estimate on burns 100 AI calls silently —
  // surprises the admin and risks blowing the daily quota gate
  // half-way through (the rest of the topics would just silently
  // skip with a warning each).
  //
  // 20 is the same cap LLM-as-Judge uses for sync runs; we keep the
  // numbers aligned so admins have one mental model.
  if (parsed.autoEstimateDifficulty && inserted.length > 0) {
    const AUTO_ESTIMATE_BATCH_CAP = 20
    const toEstimate = inserted.slice(0, AUTO_ESTIMATE_BATCH_CAP)
    for (let i = 0; i < toEstimate.length; i++) {
      const row = toEstimate[i]
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
    // If the batch was capped, expose that as a softFailure-style row
    // so the UI can tell the admin: "20 of 100 got difficulty; the
    // other 80 are unestimated — run the re-estimate action later."
    if (inserted.length > AUTO_ESTIMATE_BATCH_CAP) {
      for (
        let i = AUTO_ESTIMATE_BATCH_CAP;
        i < inserted.length;
        i++
      ) {
        failed.push({
          index: -1,
          error: `topic ${inserted[i].id.slice(0, 8)}: auto-estimate skipped (batch over ${AUTO_ESTIMATE_BATCH_CAP}-row AI cap; estimate later)`,
        })
      }
    }
  }

  if (inserted.length > 0) {
    revalidatePath(`/workspaces/${task.workspaceId}/tasks/${task.id}`)
  }
  return { created: inserted.length, failed }
}

/**
 * Batch-edit imported topic itemData with JSON Merge Patch semantics.
 *
 * This is intentionally conservative: only unassigned `drafting` rows
 * are editable. Submitted/reviewed work remains immutable from this
 * owner surface so annotations never drift away from the item the
 * labeler actually judged.
 */
export async function batchPatchTopicItemData(
  input: z.infer<typeof batchPatchTopicItemDataSchema>,
): Promise<BatchPatchTopicItemDataResult> {
  const parsed = batchPatchTopicItemDataSchema.parse(input)
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

  const topicIds = Array.from(new Set(parsed.topicIds))
  const rows = await db
    .select()
    .from(topics)
    .where(and(eq(topics.taskId, parsed.taskId), inArray(topics.id, topicIds)))

  const byId = new Map(rows.map((topic) => [topic.id, topic]))
  const updated: string[] = []
  const skipped: BatchPatchTopicItemDataResult['skipped'] = []
  const failed: BatchPatchTopicItemDataResult['failed'] = []

  for (const topicId of topicIds) {
    const topic = byId.get(topicId)
    if (!topic) {
      skipped.push({ topicId, reason: 'Topic is not in this task.' })
      continue
    }
    if (topic.status !== 'drafting') {
      skipped.push({
        topicId,
        reason: `Topic is ${topic.status}; only drafting topics are editable.`,
      })
      continue
    }
    if (topic.assignedTo) {
      skipped.push({
        topicId,
        reason: 'Topic is already assigned; release it before editing data.',
      })
      continue
    }

    let base: JsonRecord
    try {
      base = itemDataShape.parse(topic.itemData) as JsonRecord
    } catch {
      failed.push({
        topicId,
        error: 'Existing itemData is not an object.',
      })
      continue
    }

    const patched = applyTopicItemMergePatch(
      base,
      parsed.patch as JsonRecord,
    )

    let validated: unknown
    try {
      validated = template.itemSchema.parse(patched)
    } catch (e) {
      const error =
        e instanceof z.ZodError
          ? e.issues
              .map((issue) => `${issue.path.join('.') || 'item'}: ${issue.message}`)
              .join('; ')
          : e instanceof Error
            ? e.message
            : 'unknown validation error'
      failed.push({ topicId, error })
      continue
    }

    const result = await db
      .update(topics)
      .set({
        itemData: validated,
        version: topic.version + 1,
      })
      .where(and(eq(topics.id, topic.id), eq(topics.version, topic.version)))
      .returning({ id: topics.id })

    if (result.length === 0) {
      failed.push({
        topicId,
        error: 'Topic changed while editing; refresh and try again.',
      })
      continue
    }
    updated.push(topicId)
  }

  if (updated.length > 0) {
    await db.insert(events).values({
      type: 'topic.batch_updated',
      workspaceId: task.workspaceId,
      actorId: user.id,
      payload: {
        taskId: task.id,
        topicIds: updated,
        patchKeys: summarizeTopicPatchKeys(parsed.patch as JsonRecord),
        skipped,
        failedCount: failed.length,
      },
    })
    revalidatePath(`/workspaces/${task.workspaceId}/tasks/${task.id}`)
  }

  return { updated, skipped, failed }
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

  // Quota-pool distribution (spec §4.1 配额抢单): cap how many topics one
  // annotator may hold in this task. No-op for open-queue / round-robin /
  // random, or when no quota is configured.
  await assertWithinClaimQuota(task.id, task.templateConfig, user.id)

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

  // Maintenance fix #6: /my/queue + /my/tasks + the task detail page
  // all read topic.assignedTo. Repaint so the claim is visible.
  revalidatePath('/my/queue')
  revalidatePath(`/my/tasks/${task.id}`)
  revalidatePath(`/workspaces/${task.workspaceId}/tasks/${task.id}`)
  return updated[0]
}

const claimTopicsSchema = z.object({
  /** De-duped + capped at 50 — a labeler grabbing a screenful of the
   *  queue at once. Each id is claimed independently. */
  topicIds: z.array(uuidLike).min(1).max(50),
})

export interface ClaimTopicsResult {
  /** Topic ids successfully claimed by the caller in this batch. */
  claimed: string[]
  /** Topics we deliberately left alone (already claimed, over quota,
   *  task not open, not found) — each with a human-readable reason so
   *  the UI can explain the partial result. */
  skipped: Array<{ topicId: string; reason: string }>
}

/**
 * Bulk-claim several open topics in one call (spec §4.3 任务广场 —
 * labelers grabbing a batch of work from the queue instead of clicking
 * one card at a time).
 *
 * Reuses the EXACT same per-topic safety primitives as `claimTopic`:
 *   - the task.status === 'open' gate,
 *   - the per-annotator quota check (`assertWithinClaimQuota`),
 *   - the atomic `assignedTo IS NULL` + version CAS claim.
 *
 * Crucially this is skip-and-continue, NOT all-or-nothing: a topic that
 * was claimed by someone else a moment ago (lost the CAS race), or that
 * pushes the caller over quota, or whose task got paused, is recorded in
 * `skipped` and the rest of the batch still proceeds. The quota check is
 * re-run before EACH claim so a 50-id batch can't blow past the cap — it
 * stops claiming the instant the caller's held count reaches the limit.
 *
 * Auth: `requireUser` (any signed-in annotator), same as `claimTopic`.
 * Cross-task is fine — each topic resolves its own task + workspace.
 */
export async function claimTopics(
  input: z.infer<typeof claimTopicsSchema>,
): Promise<ClaimTopicsResult> {
  const parsed = claimTopicsSchema.parse(input)
  const user = await requireUser()
  const db = getDb()

  // De-dup so a doubled id in the selection can't double-count toward
  // quota or produce two result rows.
  const topicIds = Array.from(new Set(parsed.topicIds))

  const claimed: string[] = []
  const skipped: ClaimTopicsResult['skipped'] = []
  // (workspaceId, taskId) pairs we actually claimed in — revalidated once
  // at the end so a 20-topic batch doesn't fire 20 redundant cache busts
  // per path. Keyed `${workspaceId} ${taskId}` for cheap de-dup.
  const touchedTasks = new Set<string>()

  for (const topicId of topicIds) {
    const [topic] = await db
      .select()
      .from(topics)
      .where(eq(topics.id, topicId))
      .limit(1)
    if (!topic) {
      skipped.push({ topicId, reason: 'Topic no longer exists.' })
      continue
    }

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, topic.taskId))
      .limit(1)
    if (!task) {
      skipped.push({ topicId, reason: 'Task no longer exists.' })
      continue
    }

    if (task.status !== 'open') {
      skipped.push({
        topicId,
        reason: `Task is ${task.status} — topics cannot be claimed.`,
      })
      continue
    }

    // Same per-annotator quota gate as claimTopic. Re-checked per topic so
    // the batch stops at the cap rather than over-claiming. A ConflictError
    // here means "at quota" — record it and skip; any other error also
    // skips so one bad row never aborts the whole batch.
    try {
      await assertWithinClaimQuota(task.id, task.templateConfig, user.id)
    } catch (e) {
      skipped.push({
        topicId,
        reason:
          e instanceof ConflictError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Quota check failed.',
      })
      continue
    }

    const updated = await db
      .update(topics)
      .set({ assignedTo: user.id, version: topic.version + 1 })
      .where(and(eq(topics.id, topicId), isNull(topics.assignedTo)))
      .returning()

    if (updated.length === 0) {
      skipped.push({
        topicId,
        reason: 'Already claimed by another annotator.',
      })
      continue
    }

    await db.insert(events).values({
      type: 'topic.claimed',
      workspaceId: task.workspaceId,
      actorId: user.id,
      payload: { topicId: topic.id, taskId: task.id, viaBatch: true },
    })

    claimed.push(topicId)
    touchedTasks.add(`${task.workspaceId} ${task.id}`)
  }

  // Repaint the same surfaces claimTopic touches, but de-duped across the
  // batch (one revalidate per affected task).
  if (claimed.length > 0) {
    revalidatePath('/my/queue')
    for (const key of touchedTasks) {
      const [workspaceId, taskId] = key.split(' ')
      revalidatePath(`/my/tasks/${taskId}`)
      revalidatePath(`/workspaces/${workspaceId}/tasks/${taskId}`)
    }
  }

  return { claimed, skipped }
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

  // Maintenance fix #6.
  revalidatePath('/my/queue')
  revalidatePath(`/my/tasks/${task.id}`)
  revalidatePath(`/workspaces/${task.workspaceId}/tasks/${task.id}`)
  return { ok: true as const }
}
