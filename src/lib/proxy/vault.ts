import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'

/**
 * Supabase Vault wrapper.
 *
 * Supabase ships with `pgsodium` + a `vault` schema that gives you
 * row-level-encrypted secrets at rest. Secrets are written via
 * `vault.create_secret(secret, name, description)` and read via
 * `vault.decrypted_secrets` (a view that decrypts only for callers with
 * the appropriate role — our service-role connection qualifies).
 *
 * We use the vault to store upstream LLM provider keys (Doubao / Anthropic /
 * OpenAI / DeepSeek / etc.). The `provider_connections.vault_ref` column
 * holds the secret's NAME; the actual ciphertext stays in `vault.secrets`.
 *
 * Why this matters: a hostile read against the public `provider_connections`
 * table (anonymous bucket, Postgres injection, …) yields only names like
 * `lh_provider_doubao_<uuid>` — the keys themselves require an explicit
 * privileged query against the vault schema.
 *
 * Operationally:
 *   - WRITES use SECURITY DEFINER functions provided by Supabase, so we
 *     don't need raw access to `vault.secrets`.
 *   - READS go through `vault.decrypted_secrets`, which requires `pgsodium`
 *     access. Our service-role Postgres connection has it; client-side
 *     anon-key connections do not.
 *
 * Failure modes:
 *   - Vault not enabled on the project → `relation "vault.secrets" does not exist`
 *     We surface this as a typed error so the connection-create UI can
 *     prompt the user to enable Vault in their Supabase dashboard.
 */

const SECRET_PREFIX = 'lh_provider_'

export class VaultUnavailableError extends Error {
  constructor() {
    super(
      'Supabase Vault is not enabled on this project. Enable it via Dashboard → Database → Extensions → search "vault" → Enable.',
    )
    this.name = 'VaultUnavailableError'
  }
}

/**
 * Insert a new secret. Returns the vault ref (its `name`), which the caller
 * stores in `provider_connections.vault_ref`. Names are content-prefixed +
 * suffixed with a random id so collisions are impossible.
 */
export async function storeProviderSecret(
  plainKey: string,
  description: string,
): Promise<string> {
  const db = getDb()
  const name = `${SECRET_PREFIX}${crypto.randomUUID()}`
  try {
    await db.execute(
      sql`SELECT vault.create_secret(${plainKey}, ${name}, ${description})`,
    )
  } catch (e) {
    if (
      e instanceof Error &&
      /vault\.create_secret.*does not exist|schema "vault"/.test(e.message)
    ) {
      throw new VaultUnavailableError()
    }
    throw e
  }
  return name
}

interface DecryptedRow {
  decrypted_secret: string | null
}

/**
 * Read a secret by its vault ref. Returns null if the ref is missing
 * (e.g. someone deleted the row directly).
 */
export async function readProviderSecret(
  vaultRef: string,
): Promise<string | null> {
  const db = getDb()
  try {
    const rows = (await db.execute(
      sql`SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ${vaultRef} LIMIT 1`,
    )) as unknown as { rows: DecryptedRow[] } | DecryptedRow[]
    // postgres-js returns an array directly; some drivers wrap in { rows }.
    const arr = Array.isArray(rows) ? rows : rows.rows
    return arr[0]?.decrypted_secret ?? null
  } catch (e) {
    if (
      e instanceof Error &&
      /vault\.decrypted_secrets|schema "vault"/.test(e.message)
    ) {
      throw new VaultUnavailableError()
    }
    throw e
  }
}

/**
 * Hard-delete a vault secret by name. Used when rotating or deleting a
 * provider connection.
 */
export async function deleteProviderSecret(vaultRef: string): Promise<void> {
  const db = getDb()
  try {
    await db.execute(sql`DELETE FROM vault.secrets WHERE name = ${vaultRef}`)
  } catch (e) {
    if (
      e instanceof Error &&
      /vault\.secrets|schema "vault"/.test(e.message)
    ) {
      throw new VaultUnavailableError()
    }
    throw e
  }
}

/**
 * Cheap probe — true if the vault schema is accessible. Used by the UI to
 * show a helpful warning before the user tries to create a connection.
 */
export async function isVaultAvailable(): Promise<boolean> {
  const db = getDb()
  try {
    await db.execute(sql`SELECT 1 FROM vault.secrets LIMIT 1`)
    return true
  } catch {
    return false
  }
}
