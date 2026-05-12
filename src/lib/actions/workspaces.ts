'use server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { workspaces, events } from '@/lib/db/schema'
import { requireUser } from '@/lib/auth/guards'
import { ValidationError } from '@/lib/errors'
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
