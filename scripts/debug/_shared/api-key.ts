/**
 * Demo workspace API-key acquisition for the debug toolkit.
 *
 * Mirrors src/lib/auth/api-key.ts (which we cannot import — it carries
 * `import 'server-only'`). On every call we either:
 *   1. Find an existing, non-revoked debug key for the demo workspace, OR
 *   2. Mint a fresh one and return the plain bearer.
 *
 * Because the plain key is only persisted in-memory for option 2, we always
 * mint on first call after a process restart. Subsequent calls within the same
 * process reuse the cached plain bearer.
 *
 * Why a dedicated 'debug-mcp-' prefix on the name? It lets `reset_demo` find
 * + revoke just MCP-issued keys without touching `bootstrap-` keys the user
 * may have minted manually for their own curl tests.
 */
import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { type Db, schema } from './db'

export const DEMO_WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'
export const DEMO_ADMIN_ID = '00000000-0000-0000-0000-000000000001'

const API_KEY_PREFIX = 'lh_ws_'
const PREFIX_DISPLAY_LEN = 14
const DEBUG_KEY_NAME_PREFIX = 'debug-mcp-'

let cachedPlain: string | null = null

export function mintKey(): { plain: string; hash: string; prefix: string } {
  const random = randomBytes(32).toString('base64url')
  const plain = `${API_KEY_PREFIX}${random}`
  const hash = createHash('sha256').update(plain).digest('hex')
  const prefix = plain.slice(0, PREFIX_DISPLAY_LEN)
  return { plain, hash, prefix }
}

/**
 * Ensure the demo workspace exists and return a plain workspace API key.
 *
 * Idempotent on user + workspace (stable UUIDs). Always inserts a new API key
 * row, but caches the plain bearer in memory so a single MCP process only
 * mints once per restart.
 */
export async function ensureDemoApiKey(db: Db): Promise<{
  plain: string
  workspaceId: string
  apiKeyId: string
}> {
  // Ensure demo user + workspace (cheap, idempotent — same pattern as bootstrap-demo).
  await db
    .insert(schema.users)
    .values({
      id: DEMO_ADMIN_ID,
      email: 'demo-admin@labelhub.local',
      displayName: 'Demo Admin',
    })
    .onConflictDoNothing()

  await db
    .insert(schema.workspaces)
    .values({
      id: DEMO_WORKSPACE_ID,
      name: 'Demo · Agent Trace Eval',
      templateMode: 'agent-trace-eval',
      adminId: DEMO_ADMIN_ID,
      settings: { bootstrap: true },
    })
    .onConflictDoNothing()

  // Reuse cached plain bearer within this process if we already minted one.
  // We don't have the apiKeyId in that case, so re-fetch it by hash.
  if (cachedPlain) {
    const hash = createHash('sha256').update(cachedPlain).digest('hex')
    const [existing] = await db
      .select({ id: schema.workspaceApiKeys.id })
      .from(schema.workspaceApiKeys)
      .where(eq(schema.workspaceApiKeys.keyHash, hash))
      .limit(1)
    if (existing) {
      return {
        plain: cachedPlain,
        workspaceId: DEMO_WORKSPACE_ID,
        apiKeyId: existing.id,
      }
    }
    // Cache went stale (DB reset under us). Fall through to mint a new one.
    cachedPlain = null
  }

  const { plain, hash, prefix } = mintKey()
  const name = `${DEBUG_KEY_NAME_PREFIX}${new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '')}`
  const [row] = await db
    .insert(schema.workspaceApiKeys)
    .values({
      workspaceId: DEMO_WORKSPACE_ID,
      name,
      keyHash: hash,
      prefix,
      createdBy: DEMO_ADMIN_ID,
    })
    .returning({ id: schema.workspaceApiKeys.id })

  cachedPlain = plain
  return { plain, workspaceId: DEMO_WORKSPACE_ID, apiKeyId: row.id }
}
