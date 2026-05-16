/**
 * One-off DDL helper — applies the additive schema changes that
 * drizzle-kit push couldn't push because the Supabase pooler chokes
 * on the full-schema introspection step (the pull stage was still
 * spinning at 7+ minutes; the actual DDL we need is trivially fast).
 *
 * Operations (all idempotent — IF NOT EXISTS):
 *   1. ALTER TABLE annotations ADD COLUMN started_at timestamp
 *   2. ALTER TABLE annotations ADD COLUMN duration_sec integer
 *   3. CREATE TABLE notifications (...)
 *   4. CREATE INDEX notifications_user_unread_idx
 *   5. CREATE INDEX notifications_user_created_idx
 *
 * Pulls DATABASE_URL from .env.local — same source drizzle uses. Logs
 * each step's result so you can verify what landed.
 *
 * Run with:  npx tsx scripts/debug/apply-notifications-and-time.ts
 *
 * Safe to re-run (every statement uses IF NOT EXISTS / IF EXISTS).
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: 'annotations.started_at',
    sql: `ALTER TABLE "annotations" ADD COLUMN IF NOT EXISTS "started_at" timestamp;`,
  },
  {
    label: 'annotations.duration_sec',
    sql: `ALTER TABLE "annotations" ADD COLUMN IF NOT EXISTS "duration_sec" integer;`,
  },
  {
    label: 'CREATE TABLE notifications',
    sql: `
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "users"("id"),
        "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
        "type" text NOT NULL,
        "title" text NOT NULL,
        "body" text,
        "link_url" text NOT NULL,
        "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "actor_id" uuid REFERENCES "users"("id"),
        "read_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `.trim(),
  },
  {
    label: 'INDEX notifications_user_unread_idx',
    sql: `CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx" ON "notifications" ("user_id", "read_at");`,
  },
  {
    label: 'INDEX notifications_user_created_idx',
    sql: `CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" ("user_id", "created_at");`,
  },
]

async function main() {
  // `max: 1` keeps us off the pooler's connection-thrashing path. Each
  // statement runs sequentially on a single connection.
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false })
  try {
    // eslint-disable-next-line no-console
    console.log(`[apply] connected, running ${STATEMENTS.length} statements`)
    for (const stmt of STATEMENTS) {
      const t0 = Date.now()
      // eslint-disable-next-line no-console
      console.log(`[apply] ${stmt.label} …`)
      await sql.unsafe(stmt.sql)
      const ms = Date.now() - t0
      // eslint-disable-next-line no-console
      console.log(`[apply] ${stmt.label} ✓ (${ms}ms)`)
    }

    // Verify by querying the new schema bits.
    const [annCols] = await sql<{ has_started: boolean; has_duration: boolean }[]>`
      SELECT
        bool_or(column_name = 'started_at') AS has_started,
        bool_or(column_name = 'duration_sec') AS has_duration
      FROM information_schema.columns
      WHERE table_name = 'annotations'
    `
    const [tbl] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'notifications'
      ) AS exists
    `
    // eslint-disable-next-line no-console
    console.log('[verify]', {
      annotations_started_at: annCols.has_started,
      annotations_duration_sec: annCols.has_duration,
      notifications_table: tbl.exists,
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[apply] failed:', e)
  process.exit(1)
})
