'use server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { tasks, events } from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { TEMPLATE_MODES, type TemplateMode } from '@/lib/templates/types'
import { getTemplate } from '@/lib/templates/registry'
import '@/lib/templates/init'

/**
 * Task Server Actions.
 * Authorization: workspace admin only. Annotators interact via topics/annotations, not tasks directly.
 */

const rewardConfigSchema = z.object({
  type: z.enum([
    'cash-per-item',
    'cash-per-hour',
    'volunteer',
    'token',
    'rating-elo',
  ]),
  currency: z.string().max(8).optional(),
  amount: z.number().nonnegative().optional(),
  qualityMultiplierMin: z.number().positive().optional(),
  qualityMultiplierMax: z.number().positive().optional(),
})

const createTaskSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  guidelinesMarkdown: z.string().max(50000).optional(),
  templateMode: z.enum(TEMPLATE_MODES),
  rewardConfig: rewardConfigSchema,
  phase: z.number().int().positive().default(1),
  /** ISO 8601 datetime string */
  deadline: z.string().datetime().optional(),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>

/**
 * Create a task in draft status. Use `publishTask` to make it claimable.
 *
 * Invariant: task.templateMode MUST match its workspace.templateMode.
 * One workspace = one annotation paradigm (matches Xpert and the "Annotation OS" thesis).
 * Relax this invariant in a later iteration if multi-paradigm workspaces are wanted.
 */
export async function createTask(input: CreateTaskInput) {
  const parsed = createTaskSchema.parse(input)
  const { user, workspace } = await requireWorkspaceAdmin(parsed.workspaceId)

  if (parsed.templateMode !== workspace.templateMode) {
    throw new ValidationError(
      `Task template mode (${parsed.templateMode}) must match workspace mode (${workspace.templateMode}).`,
    )
  }

  const template = getTemplate(parsed.templateMode as TemplateMode)
  if (!template) {
    throw new ValidationError(`Template not registered: ${parsed.templateMode}`)
  }

  const db = getDb()
  const [task] = await db
    .insert(tasks)
    .values({
      workspaceId: parsed.workspaceId,
      name: parsed.name,
      description: parsed.description ?? null,
      guidelinesMarkdown: parsed.guidelinesMarkdown ?? null,
      templateMode: parsed.templateMode,
      rewardConfig: parsed.rewardConfig,
      status: 'draft',
      deadline: parsed.deadline ? new Date(parsed.deadline) : null,
      phase: parsed.phase,
    })
    .returning()

  await db.insert(events).values({
    type: 'task.created',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: {
      taskId: task.id,
      name: task.name,
      templateMode: task.templateMode,
      phase: task.phase,
    },
  })

  // Fire-and-forget Layer A guardrail bootstrap. When this is the FIRST task
  // in the workspace, `autoEnsureScopeForWorkspace` calls Haiku/Doubao to
  // derive a topic scope from the task description and writes it to
  // task_topic_scopes. Subsequent task creations short-circuit (scope already
  // exists).
  //
  // We deliberately don't await — if the AI call fails, task creation still
  // succeeds and the admin can later hit `/workspaces/{id}/api` →
  // "Generate scope" manually. The function handles its own quota check and
  // swallows errors per its own contract.
  //
  // Imported lazily inside the function so a misconfigured AI provider
  // doesn't break unrelated task-creation flows on module load.
  if (parsed.description && parsed.description.trim().length > 0) {
    void (async () => {
      try {
        const { autoEnsureScopeForWorkspace } = await import(
          './topic-scope'
        )
        await autoEnsureScopeForWorkspace({
          workspaceId: parsed.workspaceId,
          userId: user.id,
        })
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(
          `autoEnsureScopeForWorkspace failed for task ${task.id}:`,
          e instanceof Error ? e.message : e,
        )
      }
    })()
  }

  return task
}

const taskIdSchema = z.object({ taskId: z.string().uuid() })

/**
 * Open a task for annotation. Must currently be `draft`.
 */
export async function publishTask(input: z.infer<typeof taskIdSchema>) {
  const parsed = taskIdSchema.parse(input)
  const db = getDb()

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, parsed.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const { user } = await requireWorkspaceAdmin(task.workspaceId)

  if (task.status !== 'draft') {
    throw new ConflictError(
      `Task is ${task.status} — only drafts can be published.`,
    )
  }

  await db.update(tasks).set({ status: 'open' }).where(eq(tasks.id, task.id))

  await db.insert(events).values({
    type: 'task.published',
    workspaceId: task.workspaceId,
    actorId: user.id,
    payload: { taskId: task.id },
  })

  return { ok: true as const }
}

/**
 * Archive a task. Prevents new claims but preserves submitted annotations.
 */
export async function archiveTask(input: z.infer<typeof taskIdSchema>) {
  const parsed = taskIdSchema.parse(input)
  const db = getDb()

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, parsed.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const { user } = await requireWorkspaceAdmin(task.workspaceId)

  if (task.status === 'archived') {
    throw new ConflictError('Task is already archived.')
  }

  await db.update(tasks).set({ status: 'archived' }).where(eq(tasks.id, task.id))

  await db.insert(events).values({
    type: 'task.archived',
    workspaceId: task.workspaceId,
    actorId: user.id,
    payload: { taskId: task.id, previousStatus: task.status },
  })

  return { ok: true as const }
}
