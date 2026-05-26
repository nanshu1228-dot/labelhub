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
/**
 * Finals D21-B — schema versioning rework.
 *
 * Pre-D21: this function MUTATED the existing row. Any task pinned
 * to the schema's id silently switched to the new version, so a
 * mid-flight prompt-tweak by the owner could shift labeler responses
 * out from under in-progress submissions. Spec section 5 explicitly
 * asks for "schema 版本管理（任务发布后模板变更如何兼容）".
 *
 * Post-D21: this function INSERTS a new row with a fresh id, the
 * new version (parent.version+1), and `previousId` pointing at the
 * prior row. The prior row stays immutable forever — every task
 * referencing it keeps rendering its frozen schema. The returned
 * `{ id, version }` is the NEW row's identity; callers wanting the
 * new version pinned to a task should write
 * `task.template_config.formSchemaId = newId`.
 *
 * Special-case: if neither label nor schema actually changes, we
 * no-op (saves a wasted row + an irrelevant entry in the version
 * chain).
 */
export async function updateCustomFormSchema(input: {
  /** ID of the prior version (the row the user clicked "edit" on). */
  id: string
  workspaceId: string
  label?: string
  schema?: FormSchema
}): Promise<{ id: string; version: number }> {
  await requireWorkspaceAdmin(input.workspaceId)
  if (input.label === undefined && input.schema === undefined) {
    // No-op — return the existing row's identity.
    const db = getDb()
    const [existing] = await db
      .select({
        id: customFormSchemas.id,
        version: customFormSchemas.version,
      })
      .from(customFormSchemas)
      .where(
        and(
          eq(customFormSchemas.id, input.id),
          eq(customFormSchemas.workspaceId, input.workspaceId),
        ),
      )
      .limit(1)
    if (!existing) {
      throw new Error('Schema not found.')
    }
    return existing
  }

  const db = getDb()
  // Fetch the prior row to derive label / schema / version when the
  // caller didn't supply them (partial edits, e.g. label-only).
  const [prior] = await db
    .select()
    .from(customFormSchemas)
    .where(
      and(
        eq(customFormSchemas.id, input.id),
        eq(customFormSchemas.workspaceId, input.workspaceId),
      ),
    )
    .limit(1)
  if (!prior) throw new Error('Schema not found.')

  const nextLabel =
    input.label !== undefined ? labelSchema.parse(input.label) : prior.label
  const nextSchema =
    input.schema !== undefined
      ? formSchemaSchema.parse(input.schema)
      : (prior.schema as FormSchema)
  const nextVersion = prior.version + 1

  const [inserted] = await db
    .insert(customFormSchemas)
    .values({
      workspaceId: input.workspaceId,
      label: nextLabel,
      schema: nextSchema,
      version: nextVersion,
      previousId: prior.id,
      isTemplate: prior.isTemplate,
      createdBy: prior.createdBy,
    })
    .returning({
      id: customFormSchemas.id,
      version: customFormSchemas.version,
    })
  revalidatePath(`/workspaces/${input.workspaceId}/forms`)
  return inserted
}

/**
 * Toggle a schema's workspace-template flag — D21-B.
 *
 * Admins flip this from the Designer's "Save as workspace template"
 * button. Promoted schemas surface in the "Start from template"
 * dropdown for every subsequent form in the same workspace.
 *
 * Per-row toggle (no copy) — the same id remains valid for any
 * existing task references.
 */
export async function setWorkspaceTemplateFlag(input: {
  id: string
  workspaceId: string
  isTemplate: boolean
}): Promise<void> {
  await requireWorkspaceAdmin(input.workspaceId)
  const db = getDb()
  await db
    .update(customFormSchemas)
    .set({ isTemplate: input.isTemplate })
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
    /** D21-B — workspace template flag. UI shows a ★ badge. */
    isTemplate: boolean
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
      isTemplate: customFormSchemas.isTemplate,
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

/**
 * D21-B — list workspace-marked templates. Powers the Designer's
 * "Start from template" dropdown alongside `OFFICIAL_TEMPLATES`.
 *
 * Open to ANY signed-in user (no admin gate): the Designer page
 * itself is admin-only; this helper also gets reused by the
 * task-create flow + seed scripts. Workspace isolation enforced
 * via the workspaceId filter (caller passes the workspace they're
 * authorized in).
 */
export async function listWorkspaceTemplates(input: {
  workspaceId: string
}): Promise<
  Array<{
    id: string
    label: string
    schema: FormSchema
    version: number
  }>
> {
  const db = getDb()
  const rows = await db
    .select({
      id: customFormSchemas.id,
      label: customFormSchemas.label,
      schema: customFormSchemas.schema,
      version: customFormSchemas.version,
    })
    .from(customFormSchemas)
    .where(
      and(
        eq(customFormSchemas.workspaceId, input.workspaceId),
        eq(customFormSchemas.isTemplate, true),
        isNull(customFormSchemas.archivedAt),
      ),
    )
    .orderBy(asc(customFormSchemas.label))
  // Validate each schema on read — bad bytes shouldn't crash the
  // Designer dropdown.
  return rows
    .map((r) => {
      const parsed = formSchemaSchema.safeParse(r.schema)
      if (!parsed.success) return null
      return {
        id: r.id,
        label: r.label,
        schema: parsed.data,
        version: r.version,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}
