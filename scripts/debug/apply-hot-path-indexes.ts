/**
 * Maintenance pass — add composite indexes for hot-path queries
 * uncovered by the second-pass survey.
 *
 *   events_ws_ts_idx        — used by /audit, /api/workspaces/[id]/recent-events,
 *                              admin dashboard event scans
 *   events_ws_type_ts_idx   — narrows audit-by-type filter chip queries
 *   ann_user_submitted_idx  — /my/quality and /my/earnings filter by
 *                              (userId, submittedAt IS NOT NULL)
 *
 * All `IF NOT EXISTS` so re-runnable. CONCURRENTLY is preferable in
 * prod to avoid table locks, but Supabase pooler does not support it
 * — and our row counts are small enough that a momentary lock is
 * acceptable. If row counts grow past ~100k, redo as CONCURRENTLY
 * via a direct connection (not pgBouncer).
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
   
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: 'INDEX events_ws_ts_idx',
    sql: `CREATE INDEX IF NOT EXISTS "events_ws_ts_idx" ON "events" ("workspace_id", "ts" DESC);`,
  },
  {
    label: 'INDEX events_ws_type_ts_idx',
    sql: `CREATE INDEX IF NOT EXISTS "events_ws_type_ts_idx" ON "events" ("workspace_id", "type", "ts" DESC);`,
  },
  {
    label: 'INDEX ann_user_submitted_idx',
    sql: `CREATE INDEX IF NOT EXISTS "ann_user_submitted_idx" ON "annotations" ("user_id", "submitted_at");`,
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
       
      console.log(`[apply] ${stmt.label} ✓ (${Date.now() - t0}ms)`)
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
   
  console.error('[apply] failed:', e)
  process.exit(1)
})
