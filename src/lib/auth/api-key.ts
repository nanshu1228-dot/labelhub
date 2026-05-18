import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { workspaceApiKeys } from '@/lib/db/schema'

/**
 * Workspace API key issuance + authentication.
 *
 * Per security model:
 *   - Plain bearer NEVER stored. Only the SHA-256 hash sits in DB.
 *   - Plain shown to user ONCE on creation. Lost = revoke + regen.
 *   - `prefix` (first 14 chars) stored for UI display.
 *   - Distinct from Supabase user sessions. Machine-to-machine ingest only.
 */

const API_KEY_PREFIX = 'lh_ws_'
/**
 * Public demo-key prefix (Phase-17 17c). Same lookup path as
 * `lh_ws_*` (SHA-256 in workspace_api_keys.keyHash), but visibly
 * marked so an admin reviewing keys sees at a glance which row is
 * the rate-limited public demo. Treated identically by the auth
 * gate — see `acceptsPrefix()` below.
 */
const DEMO_KEY_PREFIX = 'lh_demo_'
const ACCEPTED_PREFIXES = [API_KEY_PREFIX, DEMO_KEY_PREFIX]
const PREFIX_DISPLAY_LEN = 14 // 'lh_ws_' + 8 chars

function acceptsPrefix(token: string): boolean {
  return ACCEPTED_PREFIXES.some((p) => token.startsWith(p))
}

export interface ApiKeyAuth {
  workspaceId: string
  apiKeyId: string
}

/**
 * Mint a new bearer + its hash. Caller persists the hash; returns plain for ONE-TIME display.
 */
export function generateApiKey(): {
  plain: string
  hash: string
  prefix: string
} {
  const random = randomBytes(32).toString('base64url')
  const plain = `${API_KEY_PREFIX}${random}`
  const hash = createHash('sha256').update(plain).digest('hex')
  const prefix = plain.slice(0, PREFIX_DISPLAY_LEN)
  return { plain, hash, prefix }
}

function hashKey(plain: string): string {
  return createHash('sha256').update(plain).digest('hex')
}

/**
 * Authenticate an incoming request via any of the conventional bearer headers.
 *
 * Accepted (in priority order):
 *   1. `Authorization: Bearer lh_ws_...`     OpenAI-compat / cURL standard
 *   2. `Authorization: lh_ws_...`            bare token (some SDKs)
 *   3. `x-api-key: lh_ws_...`                Anthropic SDK + Claude Code default
 *   4. `x-labelhub-api-key: lh_ws_...`       legacy LabelHub explicit header
 *
 * Supporting `x-api-key` is what lets a stock Anthropic harness (Claude Code,
 * Anthropic SDK with custom `baseURL`) authenticate against LabelHub without
 * any code change — the user just swaps their ANTHROPIC_API_KEY for an
 * `lh_ws_*` workspace key and points ANTHROPIC_BASE_URL at our proxy.
 *
 * Returns workspace context on success; structured error on failure (caller
 * maps to 401). Bumps `last_used_at` best-effort.
 */
export async function authenticateApiKey(
  request: Request,
): Promise<ApiKeyAuth | { error: string; code: 'NO_KEY' | 'INVALID' | 'EXPIRED' }> {
  const auth = request.headers.get('authorization') ?? ''
  let token = ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    token = auth.slice(7).trim()
  } else if (acceptsPrefix(auth)) {
    token = auth
  } else {
    token =
      (request.headers.get('x-api-key') ?? '').trim() ||
      (request.headers.get('x-labelhub-api-key') ?? '').trim()
  }

  if (!token || !acceptsPrefix(token)) {
    return { error: 'Missing or malformed API key.', code: 'NO_KEY' }
  }

  const hash = hashKey(token)
  const db = getDb()
  const [key] = await db
    .select()
    .from(workspaceApiKeys)
    .where(
      and(eq(workspaceApiKeys.keyHash, hash), isNull(workspaceApiKeys.revokedAt)),
    )
    .limit(1)

  if (!key) {
    return { error: 'Invalid or revoked API key.', code: 'INVALID' }
  }

  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
    return { error: 'API key has expired.', code: 'EXPIRED' }
  }

  // Best-effort lastUsedAt bump — don't block the response on failure.
  await db
    .update(workspaceApiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(workspaceApiKeys.id, key.id))

  return { workspaceId: key.workspaceId, apiKeyId: key.id }
}
