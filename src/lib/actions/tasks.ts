'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { tasks, events } from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { TEMPLATE_MODES, type TemplateMode } from '@/lib/templates/types'
import { getTemplate } from '@/lib/templates/registry'
import '@/lib/templates/init'
import { uuidLike } from '@/lib/validators/uuid'

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

const checklistItemSchema = z.object({
  /** snake_case stable storage key */
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, {
      message: 'id must be lowercase snake_case',
    }),
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
})

const templateConfigSchema = z
  .object({
    pairChecklist: z.array(checklistItemSchema).min(1).max(30).optional(),
    arenaDimensions: z.array(checklistItemSchema).min(1).max(30).optional(),
  })
  .optional()

const createTaskSchema = z.object({
  workspaceId: uuidLike,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  guidelinesMarkdown: z.string().max(50000).optional(),
  templateMode: z.enum(TEMPLATE_MODES),
  rewardConfig: rewardConfigSchema,
  /**
   * Per-task overrides for the template's pair/arena lists. When omitted,
   * the template's bake-in defaults apply. Validated against the snake_case
   * id rule + 30-item ceiling so a bad admin input can't poison the DB.
   */
  templateConfig: templateConfigSchema,
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

  // Reject templateConfig overrides for modes that don't use them
  // (agent-trace-eval has its own rubric structure, not a flat checklist).
  if (
    parsed.templateConfig &&
    parsed.templateMode !== 'pair-rubric' &&
    parsed.templateMode !== 'arena-gsb'
  ) {
    throw new ValidationError(
      `templateConfig is not supported for templateMode "${parsed.templateMode}".`,
    )
  }
  // Sanity check: pair-rubric admins use pairChecklist; arena-gsb uses
  // arenaDimensions. Crossing them is almost certainly a bug.
  if (parsed.templateConfig) {
    if (
      parsed.templateMode === 'pair-rubric' &&
      parsed.templateConfig.arenaDimensions
    ) {
      throw new ValidationError(
        'pair-rubric tasks use templateConfig.pairChecklist, not arenaDimensions.',
      )
    }
    if (
      parsed.templateMode === 'arena-gsb' &&
      parsed.templateConfig.pairChecklist
    ) {
      throw new ValidationError(
        'arena-gsb tasks use templateConfig.arenaDimensions, not pairChecklist.',
      )
    }
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
      templateConfig: parsed.templateConfig ?? null,
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

  revalidatePath(`/workspaces/${parsed.workspaceId}/tasks`)
  revalidatePath(`/workspaces/${parsed.workspaceId}`)
  return task
}

const taskIdSchema = z.object({ taskId: uuidLike })

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

  revalidatePath(`/workspaces/${task.workspaceId}/tasks`)
  revalidatePath(`/workspaces/${task.workspaceId}/tasks/${task.id}`)
  revalidatePath(`/workspaces/${task.workspaceId}`)
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

  revalidatePath(`/workspaces/${task.workspaceId}/tasks`)
  revalidatePath(`/workspaces/${task.workspaceId}/tasks/${task.id}`)
  revalidatePath(`/workspaces/${task.workspaceId}`)
  return { ok: true as const }
}
