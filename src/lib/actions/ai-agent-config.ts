'use server'

/**
 * Per-task AI Review Agent configuration — Finals P2 D9.
 *
 * Spec 4.4 says the owner configures the agent's Prompt + scoring
 * dimensions + verdict thresholds + on/off toggle. We store the
 * config blob in `tasks.template_config.aiAgent` (jsonb) so each
 * task can be tuned independently. The scheduler
 * (src/lib/actions/ai-review-submission.ts) reads from the same
 * path; this module is the writer.
 *
 * Auth: requireWorkspaceAdmin on the task's workspace. Non-admins
 * (including labelers in the same workspace) can't change agent
 * config — keeps QC consistency under one owner's control.
 */

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { uuidLike } from '@/lib/validators/uuid'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { NotFoundError, ValidationError } from '@/lib/errors'
import {
  DEFAULT_AI_AGENT_CONFIG,
  aiAgentConfigSchema,
  type AiAgentConfig,
} from './ai-agent-config-schema'

/**
 * Read the current AI Agent config for a task. Returns the defaults
 * when no config has been saved yet — the UI uses this to seed the
 * form on first visit.
 */
export async function getAiAgentConfig(input: {
  taskId: string
}): Promise<{ workspaceId: string; templateMode: string; config: AiAgentConfig }> {
  const parsedId = uuidLike.parse(input.taskId)
  const db = getDb()
  const [task] = await db
    .select({
      id: tasks.id,
      workspaceId: tasks.workspaceId,
      templateMode: tasks.templateMode,
      templateConfig: tasks.templateConfig,
    })
    .from(tasks)
    .where(eq(tasks.id, parsedId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')
  // Guard read too — the config can leak prompt content the workspace
  // owner consider proprietary.
  await requireWorkspaceAdmin(task.workspaceId)
  const existing = (task.templateConfig as { aiAgent?: unknown } | null)
    ?.aiAgent
  if (existing) {
    const safe = aiAgentConfigSchema.safeParse(existing)
    if (safe.success) {
      return {
        workspaceId: task.workspaceId,
        templateMode: task.templateMode,
        config: safe.data,
      }
    }
    // Corrupt config — fall through to defaults so the owner can
    // re-save instead of being locked out of the UI.
  }
  // The scheduler defaults to enabled=true for custom-designer; mirror
  // that here so the toggle shows the right initial state.
  return {
    workspaceId: task.workspaceId,
    templateMode: task.templateMode,
    config: {
      ...DEFAULT_AI_AGENT_CONFIG,
      enabled: task.templateMode === 'custom-designer',
    },
  }
}

/**
 * Save the AI Agent config back to `tasks.template_config.aiAgent`.
 * Merges the AI Agent slice into the existing template config so we
 * don't clobber other template-specific fields.
 */
export async function saveAiAgentConfig(input: {
  taskId: string
  config: AiAgentConfig
}): Promise<void> {
  const parsedId = uuidLike.parse(input.taskId)
  const parsedConfig = aiAgentConfigSchema.parse(input.config)
  const db = getDb()
  const [task] = await db
    .select({
      id: tasks.id,
      workspaceId: tasks.workspaceId,
      templateConfig: tasks.templateConfig,
    })
    .from(tasks)
    .where(eq(tasks.id, parsedId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')
  await requireWorkspaceAdmin(task.workspaceId)
  // Reject duplicate dimension ids — Zod's array validator can't catch
  // cross-element uniqueness on its own.
  const ids = parsedConfig.dimensions.map((d) => d.id)
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError('Dimension ids must be unique.')
  }
  const existing = (task.templateConfig as Record<string, unknown> | null) ?? {}
  await db
    .update(tasks)
    .set({
      templateConfig: { ...existing, aiAgent: parsedConfig },
    })
    .where(eq(tasks.id, parsedId))
  revalidatePath(
    `/workspaces/${task.workspaceId}/tasks/${parsedId}/ai-agent`,
  )
}
