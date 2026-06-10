/**
 * Phase-11 Dawid-Skene EM truth-inference DDL.
 *
 * Three tables, all workspace-scoped, all IF-NOT-EXISTS so re-runnable
 * through Supabase pooler. Same pattern as apply-trust-phase9.ts /
 * apply-revisions-phase10.ts.
 *
 * Tables:
 *   ds_consensus_runs   — one row per EM execution batch (admin click)
 *   ds_inferred_labels  — one row per inferred cell (topic × rubric × side)
 *   ds_rater_confusion  — one row per (run, rater) with KxK confusion matrix
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
  // ds_consensus_runs ────────────────────────────────────────────
  {
    label: 'CREATE TABLE ds_consensus_runs',
    sql: `
      CREATE TABLE IF NOT EXISTS "ds_consensus_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
        "task_id" uuid REFERENCES "tasks"("id"),
        "template_mode" text NOT NULL,
        "num_classes" integer NOT NULL,
        "cell_count" integer NOT NULL,
        "rater_count" integer NOT NULL,
        "iterations" integer NOT NULL,
        "converged" boolean NOT NULL,
        "log_likelihood" real NOT NULL,
        "triggered_by" uuid REFERENCES "users"("id"),
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `,
  },
  {
    label: 'INDEX ds_runs_workspace_idx',
    sql: `CREATE INDEX IF NOT EXISTS "ds_runs_workspace_idx" ON "ds_consensus_runs" ("workspace_id", "created_at" DESC);`,
  },
  // ds_inferred_labels ──────────────────────────────────────────
  {
    label: 'CREATE TABLE ds_inferred_labels',
    sql: `
      CREATE TABLE IF NOT EXISTS "ds_inferred_labels" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "run_id" uuid NOT NULL REFERENCES "ds_consensus_runs"("id") ON DELETE CASCADE,
        "topic_id" uuid NOT NULL REFERENCES "topics"("id"),
        "cell_key" text NOT NULL,
        "inferred_class" integer NOT NULL,
        "confidence" real NOT NULL,
        "posterior" jsonb NOT NULL,
        "vote_count" integer NOT NULL
      );
    `,
  },
  {
    label: 'INDEX ds_labels_run_idx',
    sql: `CREATE INDEX IF NOT EXISTS "ds_labels_run_idx" ON "ds_inferred_labels" ("run_id");`,
  },
  {
    label: 'INDEX ds_labels_topic_idx',
    sql: `CREATE INDEX IF NOT EXISTS "ds_labels_topic_idx" ON "ds_inferred_labels" ("topic_id");`,
  },
  // ds_rater_confusion ──────────────────────────────────────────
  {
    label: 'CREATE TABLE ds_rater_confusion',
    sql: `
      CREATE TABLE IF NOT EXISTS "ds_rater_confusion" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "run_id" uuid NOT NULL REFERENCES "ds_consensus_runs"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "users"("id"),
        "confusion" jsonb NOT NULL,
        "n_observations" integer NOT NULL,
        "accuracy" real NOT NULL,
        "bias_summary" text
      );
    `,
  },
  {
    label: 'INDEX ds_confusion_run_idx',
    sql: `CREATE INDEX IF NOT EXISTS "ds_confusion_run_idx" ON "ds_rater_confusion" ("run_id");`,
  },
  {
    label: 'INDEX ds_confusion_user_idx',
    sql: `CREATE INDEX IF NOT EXISTS "ds_confusion_user_idx" ON "ds_rater_confusion" ("user_id");`,
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
      Array<{ runs: boolean; labels: boolean; confusion: boolean }>
    >`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ds_consensus_runs') AS runs,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ds_inferred_labels') AS labels,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ds_rater_confusion') AS confusion
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
