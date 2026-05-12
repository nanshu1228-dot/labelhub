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
import '@/lib/templates/init'
import type { TemplateMode } from '@/lib/templates/types'

/**
 * Topic Server Actions.
 *
 * Authorization model:
 *   - createTopic: workspace admin only
 *   - claimTopic: any authenticated user (annotator), atomic race-safe via WHERE assignedTo IS NULL
 *   - releaseTopic: current claimer OR workspace admin
 */

const createTopicSchema = z.object({
  taskId: z.string().uuid(),
  /** Validated against template.itemSchema (template-specific) — accept arbitrary object here */
  itemData: z.record(z.string(), z.unknown()),
})

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

  return topic
}

const topicIdSchema = z.object({ topicId: z.string().uuid() })

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
