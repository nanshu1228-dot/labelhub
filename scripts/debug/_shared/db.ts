/**
 * Shared DB bootstrap for scripts/debug/* and mcp/tools/*.
 *
 * Mirrors the seed-demo / bootstrap-demo pattern:
 *   - Load .env.local first, then .env as fallback (tsx does not auto-load).
 *   - Build a postgres-js client with prepare:false (compatible with PgBouncer).
 *   - Hand back the drizzle proxy + the raw `sql` handle so callers can close it.
 *
 * Importable from plain Node — NO 'server-only' here. The Next.js DB client
 * (src/lib/db/client.ts) is server-only and would crash these tools.
 */
import { config as loadEnv } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../../../src/lib/db/schema'

let envLoaded = false
export function ensureEnv() {
  if (envLoaded) return
  // `quiet: true` suppresses dotenv's "injected env from ..." stdout banner.
  // Required because the MCP server speaks JSON-RPC over stdout — any extra
  // bytes there corrupt the protocol frames.
  loadEnv({ path: '.env.local', quiet: true })
  loadEnv({ path: '.env', quiet: true })
  envLoaded = true
}

export type Db = ReturnType<typeof drizzle<typeof schema>>
export type Sql = ReturnType<typeof postgres>

export function openDb(): { db: Db; sql: Sql; url: string } {
  ensureEnv()
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL missing. Copy .env.example to .env.local and fill it in.',
    )
  }
  const sql = postgres(url, { prepare: false })
  const db = drizzle(sql, { schema })
  return { db, sql, url }
}

/**
 * Run a callback against a fresh DB connection, always closing the socket.
 * Use from tool entrypoints to avoid leaking connections.
 */
export async function withDb<T>(fn: (ctx: { db: Db; sql: Sql }) => Promise<T>): Promise<T> {
  const { db, sql } = openDb()
  try {
    return await fn({ db, sql })
  } finally {
    await sql.end({ timeout: 1 })
  }
}

export { schema }
