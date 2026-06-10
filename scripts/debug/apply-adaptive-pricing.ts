/**
 * One-off DDL helper — adds Phase-8 adaptive-pricing columns to topics.
 * Same pattern as apply-notifications-and-time.ts: idempotent IF NOT
 * EXISTS statements applied via a single postgres-js connection,
 * bypassing the slow drizzle-kit pooler introspection.
 *
 * Run with: npx tsx scripts/debug/apply-adaptive-pricing.ts
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
   
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: 'topics.difficulty',
    sql: `ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "difficulty" integer;`,
  },
  {
    label: 'topics.difficulty_reason',
    sql: `ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "difficulty_reason" text;`,
  },
  {
    label: 'topics.difficulty_at',
    sql: `ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "difficulty_at" timestamp;`,
  },
]

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false })
  try {
     
    console.log(`[apply] connected, running ${STATEMENTS.length} statements`)
    for (const stmt of STATEMENTS) {
      const t0 = Date.now()
       
      console.log(`[apply] ${stmt.label} …`)
      await sql.unsafe(stmt.sql)
      const ms = Date.now() - t0
       
      console.log(`[apply] ${stmt.label} ✓ (${ms}ms)`)
    }
    const [check] = await sql<
      { has_difficulty: boolean; has_reason: boolean; has_at: boolean }[]
    >`
      SELECT
        bool_or(column_name = 'difficulty') AS has_difficulty,
        bool_or(column_name = 'difficulty_reason') AS has_reason,
        bool_or(column_name = 'difficulty_at') AS has_at
      FROM information_schema.columns
      WHERE table_name = 'topics'
    `
     
    console.log('[verify]', check)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
   
  console.error('[apply] failed:', e)
  process.exit(1)
})
