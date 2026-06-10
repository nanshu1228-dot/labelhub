import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
   
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

/**
 * Three CREATE TABLE statements + their indexes. All IF NOT EXISTS so
 * re-running is safe. Same single-connection postgres-js pattern as
 * apply-notifications-and-time.ts.
 */
const STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: 'CREATE TABLE llm_judges',
    sql: `
      CREATE TABLE IF NOT EXISTS "llm_judges" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
        "name" text NOT NULL,
        "tier" text NOT NULL,
        "system_prompt" text NOT NULL,
        "created_by" uuid NOT NULL REFERENCES "users"("id"),
        "revoked_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `.trim(),
  },
  {
    label: 'INDEX llm_judges_workspace_idx',
    sql: `CREATE INDEX IF NOT EXISTS "llm_judges_workspace_idx" ON "llm_judges" ("workspace_id");`,
  },
  {
    label: 'CREATE TABLE judge_runs',
    sql: `
      CREATE TABLE IF NOT EXISTS "judge_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "judge_id" uuid NOT NULL REFERENCES "llm_judges"("id"),
        "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
        "status" text DEFAULT 'running' NOT NULL,
        "sample_count" integer NOT NULL,
        "agreement_score" real,
        "error_text" text,
        "started_at" timestamp DEFAULT now() NOT NULL,
        "finished_at" timestamp
      );
    `.trim(),
  },
  {
    label: 'INDEX judge_runs_judge_idx',
    sql: `CREATE INDEX IF NOT EXISTS "judge_runs_judge_idx" ON "judge_runs" ("judge_id");`,
  },
  {
    label: 'INDEX judge_runs_workspace_idx',
    sql: `CREATE INDEX IF NOT EXISTS "judge_runs_workspace_idx" ON "judge_runs" ("workspace_id");`,
  },
  {
    label: 'CREATE TABLE judge_verdicts',
    sql: `
      CREATE TABLE IF NOT EXISTS "judge_verdicts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "judge_run_id" uuid NOT NULL REFERENCES "judge_runs"("id"),
        "annotation_id" uuid NOT NULL REFERENCES "annotations"("id"),
        "judge_payload" jsonb NOT NULL,
        "agreement_score" real NOT NULL,
        "per_rubric_breakdown" jsonb NOT NULL,
        "tokens_in" integer NOT NULL,
        "tokens_out" integer NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `.trim(),
  },
  {
    label: 'INDEX judge_verdicts_run_idx',
    sql: `CREATE INDEX IF NOT EXISTS "judge_verdicts_run_idx" ON "judge_verdicts" ("judge_run_id");`,
  },
  {
    label: 'INDEX judge_verdicts_ann_idx',
    sql: `CREATE INDEX IF NOT EXISTS "judge_verdicts_ann_idx" ON "judge_verdicts" ("annotation_id");`,
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
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('llm_judges', 'judge_runs', 'judge_verdicts')
      ORDER BY table_name
    `
     
    console.log('[verify]', tables.map((t) => t.table_name))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
   
  console.error('[apply] failed:', e)
  process.exit(1)
})
