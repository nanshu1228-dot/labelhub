/**
 * One-shot migration: add `template_config` JSONB column to `tasks`.
 *
 * Stores per-task overrides for the template — currently pairChecklist
 * and arenaDimensions. Nullable; tasks without overrides fall back to
 * the template's bake-in defaults via `getEffectiveTemplate()`.
 *
 * Idempotent: ALTER TABLE ADD COLUMN IF NOT EXISTS.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql as drizzleSql } from 'drizzle-orm'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { prepare: false })
  const db = drizzle(sql)
  await db.execute(drizzleSql`
    alter table tasks add column if not exists template_config jsonb
  `)
  console.log('✓ tasks.template_config column added (or already existed).')
  await sql.end()
}
main().catch((e) => {
  console.error('❌ migration failed:', e)
  process.exit(1)
})
