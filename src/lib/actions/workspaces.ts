'use server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import { workspaces, workspaceMembers, events } from '@/lib/db/schema'
import { requireUser, requireWorkspaceAdmin } from '@/lib/auth/guards'
import { AppError, ValidationError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { TEMPLATE_MODES, type TemplateMode } from '@/lib/templates/types'
import { getTemplate, listTemplates } from '@/lib/templates/registry'
import '@/lib/templates/init' // side-effect: register all templates

/**
 * Canonical Server Action — establishes the pattern for every mutation:
 *   1. Zod parse input
 *   2. requireUser() guard (security model)
 *   3. Domain validation (template registry lookup here)
 *   4. DB write
 *   5. Emit event (Pillar 2: event sourcing)
 *
 * Errors thrown as typed AppError subclasses — client catches and switches on code.
 */

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  templateMode: z.enum(TEMPLATE_MODES),
})

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>

export async function createWorkspace(input: CreateWorkspaceInput) {
  const parsed = createWorkspaceSchema.parse(input)
  const user = await requireUser()

  // Defense-in-depth: registry MUST contain the mode (Zod enum already
  // narrows, but registry-misregistration would be a latent bug otherwise).
  const template = getTemplate(parsed.templateMode as TemplateMode)
  if (!template) {
    throw new ValidationError(
      `Template not registered: ${parsed.templateMode}`,
    )
  }

  const db = getDb()

  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: parsed.name,
      templateMode: parsed.templateMode,
      adminId: user.id,
    })
    .returning()

  // Creator is also a workspace_member with role=admin. The auth guards
  // read from `workspace_members`, so without this row the creator can't
  // even access their own workspace post the role-aware guard refactor.
  await db
    .insert(workspaceMembers)
    .values({
      workspaceId: workspace.id,
      userId: user.id,
      role: 'admin',
    })
    .onConflictDoNothing()

  // Event sourcing (Pillar 2): every mutation appends an event.
  await db.insert(events).values({
    type: 'workspace.created',
    workspaceId: workspace.id,
    actorId: user.id,
    payload: {
      name: workspace.name,
      templateMode: workspace.templateMode,
    },
  })

  return workspace
}

// ─── Update ────────────────────────────────────────────────────────────

const renameSchema = z.object({
  workspaceId: uuidLike,
  name: z.string().min(1).max(100),
})

/**
 * Rename a workspace. Admin-only.
 *
 * Template mode is intentionally NOT editable here — switching modes mid-stream
 * would invalidate every existing annotation's rubric set. Create a new
 * workspace and migrate data if a mode swap is truly needed.
 */
export async function renameWorkspace(
  input: z.infer<typeof renameSchema>,
): Promise<{ ok: true; name: string }> {
  const parsed = renameSchema.parse(input)
  const trimmed = parsed.name.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('Workspace name cannot be blank.')
  }
  const { user, workspace } = await requireWorkspaceAdmin(parsed.workspaceId)
  if (workspace.name === trimmed) {
    // No-op rename — return success without writing.
    return { ok: true, name: trimmed }
  }

  const db = getDb()
  const [updated] = await db
    .update(workspaces)
    .set({ name: trimmed })
    .where(eq(workspaces.id, parsed.workspaceId))
    .returning({ name: workspaces.name })
  if (!updated) {
    throw new AppError('RENAME_FAILED', 'Workspace update returned no row.', 500)
  }

  await db.insert(events).values({
    type: 'workspace.renamed',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: {
      previousName: workspace.name,
      newName: trimmed,
    },
  })

  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}`)
    revalidatePath(`/workspaces/${parsed.workspaceId}/settings`)
    revalidatePath(`/account`)
  } catch {
    /* outside request context */
  }

  return { ok: true, name: updated.name }
}

/**
 * Reflection helper for UI pickers.
 * Returns only the public surface — no Zod schemas leak to the client.
 */
export async function listAvailableTemplates() {
  return listTemplates().map((t) => ({
    mode: t.mode,
    name: t.name,
    description: t.description,
    ui: t.ui,
  }))
}
