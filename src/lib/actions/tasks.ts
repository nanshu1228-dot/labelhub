"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { count, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tasks, events, topics } from "@/lib/db/schema";
import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { TEMPLATE_MODES, type TemplateMode } from "@/lib/templates/types";
import { rubricSpecSchema } from "@/lib/templates/rubric";
import { getTemplate } from "@/lib/templates/registry";
import { loadCustomFormSchema } from "@/lib/form-designer/storage";
import "@/lib/templates/init";
import { uuidLike } from "@/lib/validators/uuid";

/**
 * Task Server Actions.
 * Authorization: workspace admin only. Annotators interact via topics/annotations, not tasks directly.
 */

const rewardConfigSchema = z
  .object({
    type: z.enum([
      "cash-per-item",
      "cash-per-hour",
      "volunteer",
      "token",
      "rating-elo",
    ]),
    currency: z.string().max(8).optional(),
    baseAmountMinor: z.number().int().nonnegative().optional(),
    /** Legacy task-create payload field. New rows store baseAmountMinor. */
    amount: z.number().nonnegative().optional(),
    qualityMultiplierMin: z.number().positive().optional(),
    qualityMultiplierMax: z.number().positive().optional(),
  })
  .transform(({ amount, ...config }) => {
    const baseAmountMinor =
      config.baseAmountMinor ??
      (typeof amount === "number" ? Math.round(amount) : undefined);
    return {
      ...config,
      ...(baseAmountMinor === undefined ? {} : { baseAmountMinor }),
    };
  });

const checklistItemSchema = z.object({
  /** snake_case stable storage key */
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, {
      message: "id must be lowercase snake_case",
    }),
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
});

const taskSettingsSchema = z.object({
  tags: z.array(z.string().min(1).max(24)).max(12).optional(),
  quotaTotal: z.number().int().positive().max(1_000_000).optional(),
  distributionStrategy: z
    .enum(["open-queue", "round-robin", "quota-by-annotator"])
    .optional(),
  /** Spec 9.3 two-stage review (初审→终审). Omitted → default true at read. */
  twoStageReview: z.boolean().optional(),
});

const templateConfigSchema = z
  .object({
    pairChecklist: z.array(checklistItemSchema).min(1).max(30).optional(),
    arenaDimensions: z.array(checklistItemSchema).min(1).max(30).optional(),
    rubric: rubricSpecSchema.optional(),
    formSchemaId: uuidLike.optional(),
    taskSettings: taskSettingsSchema.optional(),
  })
  .optional();

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
});

export type CreateTaskInput = z.input<typeof createTaskSchema>;

/**
 * Create a task in draft status. Use `publishTask` to make it claimable.
 *
 * Invariant: task.templateMode MUST match its workspace.templateMode.
 * One workspace = one annotation paradigm (matches Xpert and the "Annotation OS" thesis).
 * Relax this invariant in a later iteration if multi-paradigm workspaces are wanted.
 */
export async function createTask(input: CreateTaskInput) {
  const parsed = createTaskSchema.parse(input);
  const { user, workspace } = await requireWorkspaceAdmin(parsed.workspaceId);

  if (parsed.templateMode !== workspace.templateMode) {
    throw new ValidationError(
      `Task template mode (${parsed.templateMode}) must match workspace mode (${workspace.templateMode}).`,
    );
  }

  const template = getTemplate(parsed.templateMode as TemplateMode);
  if (!template) {
    throw new ValidationError(
      `Template not registered: ${parsed.templateMode}`,
    );
  }

  // Sanity check: each template mode accepts only the config keys it
  // can actually render. This keeps the Owner flow honest: a
  // custom-designer task must point at a saved form schema, and baked
  // modes cannot accidentally carry a stale formSchemaId.
  if (parsed.templateConfig) {
    if (
      parsed.templateMode === "pair-rubric" &&
      (parsed.templateConfig.arenaDimensions ||
        parsed.templateConfig.rubric ||
        parsed.templateConfig.formSchemaId)
    ) {
      throw new ValidationError(
        "pair-rubric tasks only support templateConfig.pairChecklist.",
      );
    }
    if (
      parsed.templateMode === "arena-gsb" &&
      (parsed.templateConfig.pairChecklist ||
        parsed.templateConfig.rubric ||
        parsed.templateConfig.formSchemaId)
    ) {
      throw new ValidationError(
        "arena-gsb tasks only support templateConfig.arenaDimensions.",
      );
    }
    if (
      parsed.templateMode === "agent-trace-eval" &&
      (parsed.templateConfig.pairChecklist ||
        parsed.templateConfig.arenaDimensions ||
        parsed.templateConfig.formSchemaId)
    ) {
      throw new ValidationError(
        "agent-trace-eval tasks only support templateConfig.rubric.",
      );
    }
  }

  if (parsed.templateMode === "custom-designer") {
    const formSchemaId = parsed.templateConfig?.formSchemaId;
    if (!formSchemaId) {
      throw new ValidationError(
        "custom-designer tasks require templateConfig.formSchemaId.",
      );
    }
    if (
      parsed.templateConfig?.pairChecklist ||
      parsed.templateConfig?.arenaDimensions ||
      parsed.templateConfig?.rubric
    ) {
      throw new ValidationError(
        "custom-designer tasks only support templateConfig.formSchemaId and taskSettings.",
      );
    }
    const form = await loadCustomFormSchema({ id: formSchemaId });
    if (!form || form.workspaceId !== parsed.workspaceId) {
      throw new ValidationError(
        "Selected form schema was not found in this workspace.",
      );
    }
  } else if (parsed.templateConfig?.formSchemaId) {
    throw new ValidationError(
      "formSchemaId is only valid for custom-designer tasks.",
    );
  }

  const db = getDb();
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
      status: "draft",
      deadline: parsed.deadline ? new Date(parsed.deadline) : null,
      phase: parsed.phase,
    })
    .returning();

  await db.insert(events).values({
    type: "task.created",
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: {
      taskId: task.id,
      name: task.name,
      templateMode: task.templateMode,
      phase: task.phase,
    },
  });

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
        const { autoEnsureScopeForWorkspace } = await import("./topic-scope");
        await autoEnsureScopeForWorkspace({
          workspaceId: parsed.workspaceId,
          userId: user.id,
        });
      } catch (e) {
        console.warn(
          `autoEnsureScopeForWorkspace failed for task ${task.id}:`,
          e instanceof Error ? e.message : e,
        );
      }
    })();
  }

  revalidatePath(`/workspaces/${parsed.workspaceId}/tasks`);
  revalidatePath(`/workspaces/${parsed.workspaceId}`);
  return task;
}

const editTaskSettingsSchema = z.object({
  tags: z.array(z.string().min(1).max(24)).max(12),
  quotaTotal: z.number().int().positive().max(1_000_000).nullable(),
  distributionStrategy: z.enum([
    "open-queue",
    "round-robin",
    "quota-by-annotator",
  ]),
  /** Spec 9.3 two-stage review (初审→终审). Omitted → default true. */
  twoStageReview: z.boolean().optional(),
});

const updateTaskSchema = z.object({
  taskId: uuidLike,
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  guidelinesMarkdown: z.string().max(50000).nullable().optional(),
  rewardConfig: rewardConfigSchema.optional(),
  /** ISO 8601 datetime string, or null to clear the deadline. */
  deadline: z.string().datetime().nullable().optional(),
  /**
   * Operational settings (tags / quota / distribution). Replaces the stored
   * `taskSettings` wholesale while preserving the paradigm config keys
   * (rubric / checklist / formSchemaId) that live alongside it.
   */
  taskSettings: editTaskSettingsSchema.optional(),
});

export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

/**
 * Edit a task's base info after creation: name, description, rich-text
 * guidelines, payout policy, deadline, and operational settings
 * (tags / quota / distribution). Admin only.
 *
 * Deliberately NOT editable here: `templateMode`, the paradigm config
 * (rubric / checklist / formSchemaId), and `status`. Changing the annotation
 * paradigm after rows are collected would orphan already-submitted data
 * (see schema versioning); status changes go through the lifecycle actions
 * (publish / pause / resume / close / archive).
 *
 * The column patch + its `task.updated` audit event commit inside one
 * db.transaction — no edit lands without its trail. (The tasks table has no
 * version column; concurrent admin edits are last-write-wins, acceptable for
 * task metadata.)
 */
export async function updateTask(input: UpdateTaskInput) {
  const parsed = updateTaskSchema.parse(input);
  const db = getDb();

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, parsed.taskId))
    .limit(1);
  if (!task) throw new NotFoundError("Task");

  const { user } = await requireWorkspaceAdmin(task.workspaceId);

  if (task.status === "archived") {
    throw new ConflictError(
      "Archived tasks can't be edited — they're kept as frozen storage.",
    );
  }

  // Build the column patch from only the fields that actually changed, so a
  // no-op save doesn't write a spurious audit event.
  const patch: Partial<typeof tasks.$inferInsert> = {};
  const changed: string[] = [];
  if (parsed.name !== undefined && parsed.name !== task.name) {
    patch.name = parsed.name;
    changed.push("name");
  }
  if (parsed.description !== undefined) {
    const next = parsed.description ?? null;
    if (next !== task.description) {
      patch.description = next;
      changed.push("description");
    }
  }
  if (parsed.guidelinesMarkdown !== undefined) {
    const next = parsed.guidelinesMarkdown ?? null;
    if (next !== task.guidelinesMarkdown) {
      patch.guidelinesMarkdown = next;
      changed.push("guidelines");
    }
  }
  if (parsed.rewardConfig !== undefined) {
    patch.rewardConfig = parsed.rewardConfig;
    changed.push("reward");
  }
  if (parsed.deadline !== undefined) {
    patch.deadline = parsed.deadline ? new Date(parsed.deadline) : null;
    changed.push("deadline");
  }
  if (parsed.taskSettings !== undefined) {
    const existing = (task.templateConfig ?? {}) as Record<string, unknown>;
    patch.templateConfig = {
      ...existing,
      taskSettings: {
        tags: parsed.taskSettings.tags,
        quotaTotal: parsed.taskSettings.quotaTotal,
        distributionStrategy: parsed.taskSettings.distributionStrategy,
        twoStageReview: parsed.taskSettings.twoStageReview ?? true,
      },
    };
    changed.push("settings");
  }

  if (changed.length === 0) {
    return task; // nothing changed — idempotent no-op, no event
  }

  await db.transaction(async (tx) => {
    await tx.update(tasks).set(patch).where(eq(tasks.id, task.id));
    await tx.insert(events).values({
      type: "task.updated",
      workspaceId: task.workspaceId,
      actorId: user.id,
      payload: {
        taskId: task.id,
        name: patch.name ?? task.name,
        changedFields: changed,
      },
    });
  });

  revalidatePath(`/workspaces/${task.workspaceId}/tasks`);
  revalidatePath(`/workspaces/${task.workspaceId}/tasks/${task.id}`);
  revalidatePath(`/workspaces/${task.workspaceId}/tasks/${task.id}/edit`);
  revalidatePath(`/workspaces/${task.workspaceId}`);
  return { ...task, ...patch };
}

const taskIdSchema = z.object({ taskId: uuidLike });

/**
 * Open a task for annotation. Must currently be `draft`.
 */
export async function publishTask(input: z.infer<typeof taskIdSchema>) {
  const parsed = taskIdSchema.parse(input);
  const db = getDb();

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, parsed.taskId))
    .limit(1);
  if (!task) throw new NotFoundError("Task");

  const { user } = await requireWorkspaceAdmin(task.workspaceId);

  if (task.status !== "draft") {
    throw new ConflictError(
      `Task is ${task.status} — only drafts can be published.`,
    );
  }

  const [topicCount] = await db
    .select({ n: count() })
    .from(topics)
    .where(eq(topics.taskId, task.id));
  if ((topicCount?.n ?? 0) === 0) {
    throw new ConflictError("Import at least one topic before publishing.");
  }

  await db.update(tasks).set({ status: "open" }).where(eq(tasks.id, task.id));

  await db.insert(events).values({
    type: "task.published",
    workspaceId: task.workspaceId,
    actorId: user.id,
    payload: { taskId: task.id },
  });

  revalidatePath(`/workspaces/${task.workspaceId}/tasks`);
  revalidatePath(`/workspaces/${task.workspaceId}/tasks/${task.id}`);
  revalidatePath(`/workspaces/${task.workspaceId}`);
  return { ok: true as const };
}

async function transitionTaskStatus({
  taskId,
  nextStatus,
  eventType,
  allowedFrom,
  conflictMessage,
}: {
  taskId: string;
  nextStatus: "open" | "paused" | "closed" | "archived";
  eventType: "task.resumed" | "task.paused" | "task.closed" | "task.archived";
  allowedFrom: readonly string[];
  conflictMessage: string;
}) {
  const db = getDb();

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) throw new NotFoundError("Task");

  const { user } = await requireWorkspaceAdmin(task.workspaceId);

  if (!allowedFrom.includes(task.status)) {
    throw new ConflictError(conflictMessage.replace("{status}", task.status));
  }

  await db
    .update(tasks)
    .set({ status: nextStatus })
    .where(eq(tasks.id, task.id));

  await db.insert(events).values({
    type: eventType,
    workspaceId: task.workspaceId,
    actorId: user.id,
    payload: { taskId: task.id, previousStatus: task.status, nextStatus },
  });

  revalidatePath(`/workspaces/${task.workspaceId}/tasks`);
  revalidatePath(`/workspaces/${task.workspaceId}/tasks/${task.id}`);
  revalidatePath(`/workspaces/${task.workspaceId}`);
  return { ok: true as const };
}

/**
 * Temporarily remove an open task from the labeler queue.
 */
export async function pauseTask(input: z.infer<typeof taskIdSchema>) {
  const parsed = taskIdSchema.parse(input);
  return transitionTaskStatus({
    taskId: parsed.taskId,
    nextStatus: "paused",
    eventType: "task.paused",
    allowedFrom: ["open"],
    conflictMessage: "Task is {status} — only published tasks can be paused.",
  });
}

/**
 * Re-open a paused task for labelers.
 */
export async function resumeTask(input: z.infer<typeof taskIdSchema>) {
  const parsed = taskIdSchema.parse(input);
  return transitionTaskStatus({
    taskId: parsed.taskId,
    nextStatus: "open",
    eventType: "task.resumed",
    allowedFrom: ["paused"],
    conflictMessage: "Task is {status} — only paused tasks can be resumed.",
  });
}

/**
 * Permanently end a task's claim window while keeping exports and audits visible.
 */
export async function closeTask(input: z.infer<typeof taskIdSchema>) {
  const parsed = taskIdSchema.parse(input);
  return transitionTaskStatus({
    taskId: parsed.taskId,
    nextStatus: "closed",
    eventType: "task.closed",
    allowedFrom: ["open", "paused"],
    conflictMessage:
      "Task is {status} — only published or paused tasks can be closed.",
  });
}

/**
 * Archive a task. Prevents new claims but preserves submitted annotations.
 */
export async function archiveTask(input: z.infer<typeof taskIdSchema>) {
  const parsed = taskIdSchema.parse(input);
  return transitionTaskStatus({
    taskId: parsed.taskId,
    nextStatus: "archived",
    eventType: "task.archived",
    allowedFrom: ["draft", "open", "paused", "closed"],
    conflictMessage: "Task is already archived.",
  });
}
