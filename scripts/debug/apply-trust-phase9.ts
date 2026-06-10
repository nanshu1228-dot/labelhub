/**
 * Phase-9 trust system DDL — persistent trust + lifecycle status.
 * Same pooler-friendly direct-DDL pattern as the earlier
 * apply-*-and-time.ts scripts. All IF NOT EXISTS so re-runnable.
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
  // trust_scores ─────────────────────────────────────────────
  {
    label: 'trust_scores.workspace_id',
    sql: `ALTER TABLE "trust_scores" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");`,
  },
  {
    label: 'trust_scores.decayed_score',
    sql: `ALTER TABLE "trust_scores" ADD COLUMN IF NOT EXISTS "decayed_score" real;`,
  },
  {
    label: 'trust_scores.approved_count',
    sql: `ALTER TABLE "trust_scores" ADD COLUMN IF NOT EXISTS "approved_count" integer DEFAULT 0 NOT NULL;`,
  },
  {
    label: 'trust_scores.rejected_count',
    sql: `ALTER TABLE "trust_scores" ADD COLUMN IF NOT EXISTS "rejected_count" integer DEFAULT 0 NOT NULL;`,
  },
  {
    label: 'INDEX trust_user_ws_task_uniq',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "trust_user_ws_task_uniq" ON "trust_scores" ("user_id", "workspace_id", "task_type");`,
  },
  // workspace_members lifecycle ──────────────────────────────
  {
    label: 'workspace_members.trust_status',
    sql: `ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "trust_status" text DEFAULT 'active' NOT NULL;`,
  },
  {
    label: 'workspace_members.trust_status_reason',
    sql: `ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "trust_status_reason" text;`,
  },
  {
    label: 'workspace_members.trust_status_at',
    sql: `ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "trust_status_at" timestamp;`,
  },
  {
    label: 'workspace_members.trust_status_by',
    sql: `ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "trust_status_by" uuid REFERENCES "users"("id");`,
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
    const [check] = await sql<
      Array<{ trust_ws: boolean; member_status: boolean }>
    >`
      SELECT
        (SELECT bool_or(column_name = 'workspace_id')
         FROM information_schema.columns
         WHERE table_name = 'trust_scores') AS trust_ws,
        (SELECT bool_or(column_name = 'trust_status')
         FROM information_schema.columns
         WHERE table_name = 'workspace_members') AS member_status
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
