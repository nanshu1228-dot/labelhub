'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events, toolProviders } from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { ConflictError, NotFoundError } from '@/lib/errors'
import { TOOL_PROVIDER_KINDS } from '@/lib/trajectories/schema'

/**
 * Tool Provider lifecycle.
 *
 * - declareToolProvider: promote an inferred provider to declared by adding
 *   a full manifest; or create a new declared provider from scratch.
 * - updateToolProvider: edit name / manifest on a declared provider.
 * - deprecateToolProvider: mark as deprecated (status='deprecated').
 *   Ingest still resolves matching identifiers but UI can mark as legacy.
 *
 * Authorization: workspace admin only.
 */

// 32KB cap on manifest JSON — tool manifests are by nature small
// descriptors; anything bigger is a misshapen import. Phase-15
// maintenance: matches the annotation-payload budget pattern.
const MANIFEST_BYTE_BUDGET = 32_000
const manifestShape = z
  .record(z.string(), z.unknown())
  .refine(
    (v) =>
      Buffer.byteLength(JSON.stringify(v ?? {}), 'utf8') <=
      MANIFEST_BYTE_BUDGET,
    {
      message: `manifest exceeds ${MANIFEST_BYTE_BUDGET / 1000}KB byte budget`,
    },
  )

const declareSchema = z.object({
  workspaceId: z.string().uuid(),
  kind: z.enum(TOOL_PROVIDER_KINDS),
  identifier: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  manifest: manifestShape,
})

export async function declareToolProvider(
  input: z.infer<typeof declareSchema>,
) {
  const parsed = declareSchema.parse(input)
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)
  const db = getDb()

  // Upsert: if an inferred provider exists with this identifier, promote it.
  const [row] = await db
    .insert(toolProviders)
    .values({
      workspaceId: parsed.workspaceId,
      kind: parsed.kind,
      identifier: parsed.identifier,
      name: parsed.name,
      manifest: parsed.manifest,
      source: 'declared',
    })
    .onConflictDoUpdate({
      target: [toolProviders.workspaceId, toolProviders.identifier],
      set: {
        kind: parsed.kind,
        name: parsed.name,
        manifest: parsed.manifest,
        source: 'declared',
      },
    })
    .returning()

  await db.insert(events).values({
    type: 'tool_provider.declared',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: {
      toolProviderId: row.id,
      identifier: row.identifier,
      kind: row.kind,
    },
  })

  revalidatePath(`/workspaces/${parsed.workspaceId}/connections`)
  revalidatePath(`/workspaces/${parsed.workspaceId}/analyze`)
  return row
}

const updateSchema = z.object({
  toolProviderId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  manifest: manifestShape.optional(),
})

export async function updateToolProvider(
  input: z.infer<typeof updateSchema>,
) {
  const parsed = updateSchema.parse(input)
  const db = getDb()

  const [existing] = await db
    .select()
    .from(toolProviders)
    .where(eq(toolProviders.id, parsed.toolProviderId))
    .limit(1)
  if (!existing) throw new NotFoundError('Tool provider')

  const { user } = await requireWorkspaceAdmin(existing.workspaceId)

  const updates: Partial<typeof toolProviders.$inferInsert> = {}
  if (parsed.name !== undefined) updates.name = parsed.name
  if (parsed.manifest !== undefined) updates.manifest = parsed.manifest

  if (Object.keys(updates).length === 0) {
    return existing // no-op
  }

  const [row] = await db
    .update(toolProviders)
    .set(updates)
    .where(eq(toolProviders.id, parsed.toolProviderId))
    .returning()

  await db.insert(events).values({
    type: 'tool_provider.updated',
    workspaceId: existing.workspaceId,
    actorId: user.id,
    payload: {
      toolProviderId: row.id,
      identifier: row.identifier,
      changes: Object.keys(updates),
    },
  })

  revalidatePath(`/workspaces/${existing.workspaceId}/connections`)
  revalidatePath(`/workspaces/${existing.workspaceId}/analyze`)
  return row
}

const idSchema = z.object({ toolProviderId: z.string().uuid() })

export async function deprecateToolProvider(input: z.infer<typeof idSchema>) {
  const parsed = idSchema.parse(input)
  const db = getDb()

  const [existing] = await db
    .select()
    .from(toolProviders)
    .where(eq(toolProviders.id, parsed.toolProviderId))
    .limit(1)
  if (!existing) throw new NotFoundError('Tool provider')

  const { user } = await requireWorkspaceAdmin(existing.workspaceId)

  if (existing.status === 'deprecated') {
    throw new ConflictError('Tool provider is already deprecated.')
  }

  await db
    .update(toolProviders)
    .set({ status: 'deprecated' })
    .where(
      and(
        eq(toolProviders.id, parsed.toolProviderId),
        eq(toolProviders.status, 'active'),
      ),
    )

  await db.insert(events).values({
    type: 'tool_provider.deprecated',
    workspaceId: existing.workspaceId,
    actorId: user.id,
    payload: {
      toolProviderId: existing.id,
      identifier: existing.identifier,
    },
  })

  revalidatePath(`/workspaces/${existing.workspaceId}/connections`)
  revalidatePath(`/workspaces/${existing.workspaceId}/analyze`)
  return { ok: true as const }
}
