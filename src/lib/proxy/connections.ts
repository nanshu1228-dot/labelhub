import 'server-only'

/**
 * Provider connection helpers.
 *
 * A "connection" is a workspace's credentials for one upstream LLM provider.
 * Stored in `provider_connections` (metadata + vault ref) + Supabase Vault
 * (the plain API key). Each connection has its own optional base URL and
 * rate limits.
 *
 * Resolution rules at proxy request time (`resolveConnection`):
 *   1. Look up the workspace's ENABLED connections of the given provider_kind
 *   2. Pick the most-recently-used one (deterministic, no ambiguity surprises)
 *   3. Read its plain key from Vault
 *   4. If no connection exists for that kind → fall back to env var
 *      (so existing deployments keep working — DOUBAO_API_KEY etc.)
 *   5. If neither → throw UPSTREAM_NOT_CONFIGURED
 *
 * The "use the most-recently-used" rule is a deliberate UX choice: rotating
 * a key = create new + disable old; the new one starts winning naturally
 * once it gets its first hit, no manual cutover needed.
 */

import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { providerConnections, events } from '@/lib/db/schema'
import {
  storeProviderSecret,
  readProviderSecret,
  deleteProviderSecret,
} from './vault'
import { getProviderDef } from './provider-registry'

export interface ResolvedConnection {
  /** Plain API key fetched from Vault (or env fallback). */
  apiKey: string
  /** Resolved base URL (connection override or provider default). */
  baseUrl: string
  /** The connection row, if from DB; null if env fallback was used. */
  connectionId: string | null
  /** Rate limits to enforce, if any. */
  rateLimitRpm: number | null
  rateLimitTpm: number | null
  source: 'db' | 'env'
}

/**
 * The hot-path lookup. Called by every proxy request.
 */
export async function resolveConnection(opts: {
  workspaceId: string
  providerKind: string
}): Promise<ResolvedConnection | null> {
  const def = getProviderDef(opts.providerKind)
  if (!def) return null

  const db = getDb()
  const rows = await db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.workspaceId, opts.workspaceId),
        eq(providerConnections.providerKind, opts.providerKind),
        eq(providerConnections.enabled, 'true'),
      ),
    )
    .orderBy(
      desc(providerConnections.lastUsedAt),
      desc(providerConnections.createdAt),
    )
    .limit(1)

  if (rows[0]) {
    const conn = rows[0]
    const apiKey = await readProviderSecret(conn.vaultRef)
    if (!apiKey) {
      // The vault entry is missing but the connection row exists — likely
      // someone purged the vault without removing the row. Don't blindly
      // fall back to env (admins expected DB-managed); surface an error.
      throw new Error(
        `connection ${conn.id} has vault_ref="${conn.vaultRef}" but no secret found — re-create the connection`,
      )
    }
    return {
      apiKey,
      baseUrl: (conn.baseUrl || def.defaultBaseUrl).replace(/\/$/, ''),
      connectionId: conn.id,
      rateLimitRpm: conn.rateLimitRpm,
      rateLimitTpm: conn.rateLimitTpm,
      source: 'db',
    }
  }

  // No DB connection → env fallback. Lets the existing deployment keep
  // working without forcing every workspace to provision a connection up
  // front.
  const envValue = process.env[def.envFallback]
  if (envValue) {
    return {
      apiKey: envValue,
      baseUrl: def.defaultBaseUrl,
      connectionId: null,
      rateLimitRpm: null,
      rateLimitTpm: null,
      source: 'env',
    }
  }

  return null
}

/**
 * Bump `last_used_at` on a connection. Called post-call (best effort);
 * supports the "most-recently-used wins" rotation rule.
 */
export async function touchConnection(connectionId: string): Promise<void> {
  const db = getDb()
  await db
    .update(providerConnections)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(providerConnections.id, connectionId))
}

// ───────────────────────────────────────────────────────────────────────
// CRUD (used by the connections UI / Server Actions)
// ───────────────────────────────────────────────────────────────────────

export interface CreateConnectionInput {
  workspaceId: string
  providerKind: string
  displayName: string
  apiKey: string
  baseUrl?: string | null
  rateLimitRpm?: number | null
  rateLimitTpm?: number | null
  createdBy?: string | null
}

export async function createConnection(
  input: CreateConnectionInput,
): Promise<{ id: string }> {
  const def = getProviderDef(input.providerKind)
  if (!def) throw new Error(`unknown provider_kind: ${input.providerKind}`)
  if (!input.apiKey || input.apiKey.length < 8) {
    throw new Error('apiKey is too short')
  }

  const db = getDb()
  const vaultRef = await storeProviderSecret(
    input.apiKey,
    `LabelHub provider connection (${input.providerKind} / ${input.displayName})`,
  )
  const keyDisplay = `…${input.apiKey.slice(-4)}`

  const [row] = await db
    .insert(providerConnections)
    .values({
      workspaceId: input.workspaceId,
      providerKind: input.providerKind,
      displayName: input.displayName,
      baseUrl: input.baseUrl ?? null,
      vaultRef,
      keyDisplay,
      rateLimitRpm: input.rateLimitRpm ?? null,
      rateLimitTpm: input.rateLimitTpm ?? null,
      enabled: 'true',
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: providerConnections.id })

  await db.insert(events).values({
    type: 'provider_connection.created',
    workspaceId: input.workspaceId,
    actorId: input.createdBy ?? null,
    payload: {
      connectionId: row.id,
      providerKind: input.providerKind,
      displayName: input.displayName,
    },
  })

  return row
}

export async function disableConnection(opts: {
  connectionId: string
  workspaceId: string
}): Promise<void> {
  const db = getDb()
  await db
    .update(providerConnections)
    .set({ enabled: 'false' })
    .where(
      and(
        eq(providerConnections.id, opts.connectionId),
        eq(providerConnections.workspaceId, opts.workspaceId),
      ),
    )
  await db.insert(events).values({
    type: 'provider_connection.disabled',
    workspaceId: opts.workspaceId,
    actorId: null,
    payload: { connectionId: opts.connectionId },
  })
}

export async function enableConnection(opts: {
  connectionId: string
  workspaceId: string
}): Promise<void> {
  const db = getDb()
  await db
    .update(providerConnections)
    .set({ enabled: 'true' })
    .where(
      and(
        eq(providerConnections.id, opts.connectionId),
        eq(providerConnections.workspaceId, opts.workspaceId),
      ),
    )
}

export async function deleteConnection(opts: {
  connectionId: string
  workspaceId: string
}): Promise<void> {
  const db = getDb()
  const [conn] = await db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.id, opts.connectionId),
        eq(providerConnections.workspaceId, opts.workspaceId),
      ),
    )
    .limit(1)
  if (!conn) return
  // Best-effort vault cleanup; if Vault is unreachable, the row deletion
  // still proceeds (orphaned vault secrets are harmless and can be
  // garbage-collected later).
  try {
    await deleteProviderSecret(conn.vaultRef)
  } catch (e) {
     
    console.warn('vault delete failed for', conn.vaultRef, e)
  }
  await db
    .delete(providerConnections)
    .where(eq(providerConnections.id, conn.id))
  await db.insert(events).values({
    type: 'provider_connection.deleted',
    workspaceId: opts.workspaceId,
    actorId: null,
    payload: { connectionId: opts.connectionId, providerKind: conn.providerKind },
  })
}

export async function listConnections(workspaceId: string) {
  const db = getDb()
  return db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.workspaceId, workspaceId))
    .orderBy(desc(providerConnections.createdAt))
}
