'use server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events, workspaceApiKeys } from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { generateApiKey } from '@/lib/auth/api-key'
import { NotFoundError } from '@/lib/errors'

/**
 * API key lifecycle Server Actions.
 *
 * Per security model:
 *   - Plain key returned ONCE on creation. Subsequent reads only expose prefix.
 *   - Revoke is logical (revoked_at) — preserves audit trail.
 *   - All ops require workspace admin.
 */

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(60),
  /** Optional TTL; null = no expiration. Cap at 10 years to prevent forgotten keys. */
  expiresInDays: z.number().int().positive().max(3650).optional(),
})

export type CreateApiKeyInput = z.infer<typeof createSchema>

export async function createApiKey(input: CreateApiKeyInput) {
  const parsed = createSchema.parse(input)
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)

  const { plain, hash, prefix } = generateApiKey()
  const expiresAt = parsed.expiresInDays
    ? new Date(Date.now() + parsed.expiresInDays * 86_400_000)
    : null

  const db = getDb()
  const [row] = await db
    .insert(workspaceApiKeys)
    .values({
      workspaceId: parsed.workspaceId,
      name: parsed.name,
      keyHash: hash,
      prefix,
      createdBy: user.id,
      expiresAt,
    })
    .returning()

  await db.insert(events).values({
    type: 'api_key.created',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: { apiKeyId: row.id, name: row.name, prefix: row.prefix },
  })

  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    /** SHOW ONCE — do not store or retransmit; user must save now. */
    plainKey: plain,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }
}

const revokeSchema = z.object({ apiKeyId: z.string().uuid() })

export async function revokeApiKey(input: z.infer<typeof revokeSchema>) {
  const parsed = revokeSchema.parse(input)
  const db = getDb()
  const [key] = await db
    .select()
    .from(workspaceApiKeys)
    .where(eq(workspaceApiKeys.id, parsed.apiKeyId))
    .limit(1)
  if (!key) throw new NotFoundError('API key')

  const { user } = await requireWorkspaceAdmin(key.workspaceId)

  await db
    .update(workspaceApiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(workspaceApiKeys.id, parsed.apiKeyId))

  await db.insert(events).values({
    type: 'api_key.revoked',
    workspaceId: key.workspaceId,
    actorId: user.id,
    payload: { apiKeyId: key.id, name: key.name },
  })

  return { ok: true as const }
}

/**
 * List keys for a workspace (admin only). Returns metadata only — hash NEVER exposed.
 */
export async function listApiKeys(workspaceId: string) {
  await requireWorkspaceAdmin(workspaceId)
  const db = getDb()
  return db
    .select({
      id: workspaceApiKeys.id,
      name: workspaceApiKeys.name,
      prefix: workspaceApiKeys.prefix,
      createdAt: workspaceApiKeys.createdAt,
      lastUsedAt: workspaceApiKeys.lastUsedAt,
      expiresAt: workspaceApiKeys.expiresAt,
      revokedAt: workspaceApiKeys.revokedAt,
    })
    .from(workspaceApiKeys)
    .where(eq(workspaceApiKeys.workspaceId, workspaceId))
}
