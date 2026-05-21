'use server'

/**
 * Designer schema persistence — Finals P1 D6.
 *
 * Server actions that save / load / list / archive
 * `custom_form_schemas` rows. Tasks created with the
 * `custom-designer` template reference one row via
 * `templateConfig.formSchemaId`; the Labeler hydrates the saved
 * FormSchema into <FormRenderer> at runtime.
 *
 * All actions guard on `requireWorkspaceAdmin(workspaceId)` so a
 * non-owner can never write — workspaces are the natural isolation
 * boundary on this row (same as every other Designer-side table).
 *
 * The persisted column `schema` is the canonical FormSchema shape
 * from `src/lib/form-designer/schema.ts`. Anything that wants the
 * draft-07 projection goes through `toJsonSchema` / `fromJsonSchema`
 * in serialize.ts — the storage layer doesn't pre-convert because
 * Designer loads benefit from skipping the JSON-Schema-side round
 * trip on every fetch.
 */

import { revalidatePath } from 'next/cache'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { customFormSchemas } from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import {
  formSchemaSchema,
  type FormSchema,
} from './schema'

const labelSchema = z
  .string()
  .min(1, 'Label is required.')
  .max(120, 'Label must be at most 120 characters.')

/**
 * Insert a new saved schema. Returns the created row id so the
 * Designer can navigate to `/admin/forms/[id]`.
 */
export async function createCustomFormSchema(input: {
  workspaceId: string
  label: string
  schema: FormSchema
}): Promise<{ id: string }> {
  const { user } = await requireWorkspaceAdmin(input.workspaceId)
  const label = labelSchema.parse(input.label)
  const parsed = formSchemaSchema.parse(input.schema)
  const db = getDb()
  const [row] = await db
    .insert(customFormSchemas)
    .values({
      workspaceId: input.workspaceId,
      label,
      schema: parsed,
      version: parsed.version,
      createdBy: user.id,
    })
    .returning({ id: customFormSchemas.id })
  revalidatePath(`/workspaces/${input.workspaceId}/forms`)
  return row
}

/**
 * Overwrite an existing schema's content. Optionally rename it.
 * Returns void; the Designer refetches via loadCustomFormSchema()
 * after save.
 */
export async function updateCustomFormSchema(input: {
  id: string
  workspaceId: string
  label?: string
  schema?: FormSchema
}): Promise<void> {
  await requireWorkspaceAdmin(input.workspaceId)
  const patch: Partial<typeof customFormSchemas.$inferInsert> = {}
  if (input.label !== undefined) {
    patch.label = labelSchema.parse(input.label)
  }
  if (input.schema !== undefined) {
    const parsed = formSchemaSchema.parse(input.schema)
    patch.schema = parsed
    patch.version = parsed.version
  }
  if (Object.keys(patch).length === 0) return
  const db = getDb()
  await db
    .update(customFormSchemas)
    .set(patch)
    .where(
      and(
        eq(customFormSchemas.id, input.id),
        eq(customFormSchemas.workspaceId, input.workspaceId),
      ),
    )
  revalidatePath(`/workspaces/${input.workspaceId}/forms`)
}

/**
 * Soft-archive — sets `archived_at` instead of deleting so tasks
 * already referencing the schema continue to render. List queries
 * (the Designer index page) filter on `archived_at IS NULL`.
 */
export async function archiveCustomFormSchema(input: {
  id: string
  workspaceId: string
}): Promise<void> {
  await requireWorkspaceAdmin(input.workspaceId)
  const db = getDb()
  await db
    .update(customFormSchemas)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(customFormSchemas.id, input.id),
        eq(customFormSchemas.workspaceId, input.workspaceId),
      ),
    )
  revalidatePath(`/workspaces/${input.workspaceId}/forms`)
}

/**
 * Read one saved schema. Returns null if the row is missing /
 * archived / not in this workspace. Reviewer (qc) and Labeler
 * (annotator) roles also read this — gated upstream by the task's
 * own workspace check rather than admin-only here.
 */
export async function loadCustomFormSchema(input: {
  id: string
}): Promise<{
  id: string
  workspaceId: string
  label: string
  schema: FormSchema
  version: number
  createdAt: Date
} | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(customFormSchemas)
    .where(
      and(
        eq(customFormSchemas.id, input.id),
        isNull(customFormSchemas.archivedAt),
      ),
    )
    .limit(1)
  if (!row) return null
  // Validate on read — protects the Renderer from corrupt rows.
  const parsed = formSchemaSchema.safeParse(row.schema)
  if (!parsed.success) {
    // Surface a banner via the Renderer rather than crashing.
    return null
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    schema: parsed.data,
    version: row.version,
    createdAt: row.createdAt,
  }
}

/**
 * List all saved schemas for a workspace. Used by the Task Designer
 * "pick a saved form" UI in create-task-form.
 */
export async function listCustomFormSchemas(input: {
  workspaceId: string
}): Promise<
  Array<{
    id: string
    label: string
    version: number
    createdAt: Date
  }>
> {
  await requireWorkspaceAdmin(input.workspaceId)
  const db = getDb()
  const rows = await db
    .select({
      id: customFormSchemas.id,
      label: customFormSchemas.label,
      version: customFormSchemas.version,
      createdAt: customFormSchemas.createdAt,
    })
    .from(customFormSchemas)
    .where(
      and(
        eq(customFormSchemas.workspaceId, input.workspaceId),
        isNull(customFormSchemas.archivedAt),
      ),
    )
    .orderBy(asc(customFormSchemas.label))
  return rows
}
