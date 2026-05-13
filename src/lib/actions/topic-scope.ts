'use server'

/**
 * Topic-scope management — workspace-admin Server Actions.
 *
 * Three operations:
 *   1. `regenerateWorkspaceScope` — admin says "redo the scope". Picks the
 *      primary task, calls Haiku, upserts the workspace-fallback row.
 *   2. `editWorkspaceScopeManually` — admin overrides one or all fields.
 *      Bumps version, sets `manuallyEditedAt`, marks `generatedBy='admin-manual'`.
 *   3. `autoEnsureScopeForWorkspace` — fire-and-forget hook invoked from
 *      task creation. Generates a scope if none exists yet; cheap to call
 *      repeatedly because it short-circuits when one is already present.
 *
 * All three log against the daily AI quota.
 */

import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import { events, taskTopicScopes } from '@/lib/db/schema'
import { AppError } from '@/lib/errors'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { uuidLike } from '@/lib/validators/uuid'
import {
  generateTopicScope,
  topicScopeSchema,
  type TopicScope,
} from '@/lib/ai/topic-scope'
import {
  assertWithinDailyAIQuota,
  logAICall,
} from '@/lib/ai/quota'
import { findPrimaryTaskForScope } from '@/lib/queries/topic-scope'

// ─── Regenerate (admin-triggered) ────────────────────────────────────────

const regenerateInputSchema = z.object({
  workspaceId: uuidLike,
})

export async function regenerateWorkspaceScope(
  input: z.infer<typeof regenerateInputSchema>,
) {
  const parsed = regenerateInputSchema.parse(input)
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)
  await assertWithinDailyAIQuota(user.id)

  const primary = await findPrimaryTaskForScope(parsed.workspaceId)
  if (!primary) {
    throw new AppError(
      'NO_PRIMARY_TASK',
      'No task with a description found in this workspace. Create a task first, then regenerate the scope.',
      400,
    )
  }

  const { scope, usage } = await generateTopicScope({
    taskName: primary.name,
    taskDescription: primary.description,
  })

  const row = await upsertWorkspaceFallback(
    parsed.workspaceId,
    scope,
    'haiku',
  )

  await logAICall({
    userId: user.id,
    feature: 'topic-scope-regenerate',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: parsed.workspaceId,
  })

  await getDb().insert(events).values({
    type: 'topic_scope.regenerated',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: {
      topicScopeId: row.id,
      version: row.version,
      basedOnTaskId: primary.id,
    },
  })

  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}/api`)
    revalidatePath(`/workspaces/${parsed.workspaceId}`)
  } catch {
    /* outside request context */
  }

  return { ok: true as const, scope: row }
}

// ─── Manual edit (admin override) ───────────────────────────────────────

const editScopeSchema = z.object({
  workspaceId: uuidLike,
  scope: topicScopeSchema,
})

export async function editWorkspaceScopeManually(
  input: z.infer<typeof editScopeSchema>,
) {
  const parsed = editScopeSchema.parse(input)
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)

  const row = await upsertWorkspaceFallback(
    parsed.workspaceId,
    parsed.scope,
    'admin-manual',
    { manualEdit: true },
  )

  await getDb().insert(events).values({
    type: 'topic_scope.edited',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: {
      topicScopeId: row.id,
      version: row.version,
    },
  })

  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}/api`)
    revalidatePath(`/workspaces/${parsed.workspaceId}`)
  } catch {
    /* outside request context */
  }
  return { ok: true as const, scope: row }
}

// ─── Auto-ensure hook (called from task creation) ────────────────────────

/**
 * Generate a workspace-fallback scope if one doesn't already exist.
 *
 * Idempotent + cheap to call: returns immediately when a row is already
 * present. Used as a fire-and-forget hook from the task-creation flow.
 *
 * Failures are swallowed — proxy passes through without injection when no
 * scope is set, so a Haiku timeout shouldn't break task creation.
 *
 * Marked as a server action but typically called from another server
 * action / Route Handler, not from the client. It still passes the
 * `userId` explicitly because the calling context already has a user.
 */
export async function autoEnsureScopeForWorkspace(opts: {
  workspaceId: string
  userId: string
}): Promise<{ created: boolean; reason?: string }> {
  const db = getDb()
  const [existing] = await db
    .select({ id: taskTopicScopes.id })
    .from(taskTopicScopes)
    .where(
      and(
        eq(taskTopicScopes.workspaceId, opts.workspaceId),
        isNull(taskTopicScopes.taskId),
      ),
    )
    .limit(1)
  if (existing) return { created: false, reason: 'already-exists' }

  const primary = await findPrimaryTaskForScope(opts.workspaceId)
  if (!primary) return { created: false, reason: 'no-primary-task' }

  try {
    await assertWithinDailyAIQuota(opts.userId)
  } catch (e) {
    return {
      created: false,
      reason: `quota: ${e instanceof Error ? e.message : 'exceeded'}`,
    }
  }

  let scope: TopicScope
  let usage: Awaited<ReturnType<typeof generateTopicScope>>['usage']
  try {
    const out = await generateTopicScope({
      taskName: primary.name,
      taskDescription: primary.description,
    })
    scope = out.scope
    usage = out.usage
  } catch (e) {
    // Swallow: task creation must not fail because Haiku timed out.
    return {
      created: false,
      reason: `generate: ${e instanceof Error ? e.message : 'failed'}`,
    }
  }

  const row = await upsertWorkspaceFallback(opts.workspaceId, scope, 'haiku')
  await logAICall({
    userId: opts.userId,
    feature: 'topic-scope-auto',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: opts.workspaceId,
  })
  await db.insert(events).values({
    type: 'topic_scope.auto_generated',
    workspaceId: opts.workspaceId,
    actorId: opts.userId,
    payload: {
      topicScopeId: row.id,
      basedOnTaskId: primary.id,
    },
  })

  return { created: true }
}

// ─── Upsert helper ──────────────────────────────────────────────────────

async function upsertWorkspaceFallback(
  workspaceId: string,
  scope: TopicScope,
  generatedBy: 'haiku' | 'admin-manual' | 'admin-edit',
  opts: { manualEdit?: boolean } = {},
): Promise<typeof taskTopicScopes.$inferSelect> {
  const db = getDb()
  const now = new Date()
  const [existing] = await db
    .select()
    .from(taskTopicScopes)
    .where(
      and(
        eq(taskTopicScopes.workspaceId, workspaceId),
        isNull(taskTopicScopes.taskId),
      ),
    )
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(taskTopicScopes)
      .set({
        inScope: scope.inScope,
        outOfScope: scope.outOfScope,
        suffix: scope.suffix,
        version: existing.version + 1,
        generatedBy,
        generatedAt: now,
        manuallyEditedAt: opts.manualEdit ? now : existing.manuallyEditedAt,
      })
      .where(eq(taskTopicScopes.id, existing.id))
      .returning()
    return updated
  }

  const [created] = await db
    .insert(taskTopicScopes)
    .values({
      workspaceId,
      taskId: null,
      inScope: scope.inScope,
      outOfScope: scope.outOfScope,
      suffix: scope.suffix,
      version: 1,
      generatedBy,
      generatedAt: now,
      manuallyEditedAt: opts.manualEdit ? now : null,
    })
    .returning()
  return created
}
