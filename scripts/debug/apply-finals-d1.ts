/**
 * Finals D1 — Drizzle migration draft.
 *
 * NOT APPLIED in D1. Reviewed only. We apply it on D7 (start of P2)
 * once the Designer (P1) is functional and we won't churn the schema
 * mid-build. Reason for pre-staging: the enum extension on
 * `workflow_stage` and the three new tables are the foundation every
 * other phase touches; failing-fast on the SQL itself this early
 * means D7 is mechanical.
 *
 * Adds (all IF NOT EXISTS so re-runnable):
 *
 *   - workflow_stage enum value 'ai_review' (slots between submitted
 *     and reviewing in the new 8-state machine)
 *
 *   - custom_form_schemas (id, workspace_id, label, schema jsonb,
 *     version, created_by, created_at, archived_at): Designer-saved
 *     form definitions. templateConfig.formSchemaId references this.
 *
 *   - ai_submission_verdicts (id, annotation_id FK, judge_id FK,
 *     status, verdict, scores jsonb, reasoning, attempts, error_text,
 *     idempotency_key UNIQUE, started_at, finished_at): per-submission
 *     auto-review verdicts. Mirrors judgeVerdicts but per-annotation.
 *
 *   - export_jobs (id, workspace_id, created_by, format, config jsonb,
 *     status, row_count, byte_size, storage_path, error_text,
 *     created_at, finished_at): async export queue rows.
 *
 * Same pooler-friendly direct-DDL pattern as apply-dawid-skene-phase11.ts,
 * apply-invite-rewards-phase13.ts, etc.
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
  // ── workflow_stage enum extension ──────────────────────────────
  // ALTER TYPE ... ADD VALUE IF NOT EXISTS is the idiomatic way to
  // extend a pg enum without rewriting the column. The 'BEFORE'
  // clause keeps the enum's internal order semantically meaningful
  // (drafting → submitted → ai_review → reviewing → …).
  {
    label: "ALTER TYPE workflow_stage ADD VALUE 'ai_review'",
    sql: `
      ALTER TYPE "workflow_stage"
      ADD VALUE IF NOT EXISTS 'ai_review' BEFORE 'reviewing';
    `,
  },
  // ── custom_form_schemas ────────────────────────────────────────
  {
    label: 'CREATE TABLE custom_form_schemas',
    sql: `
      CREATE TABLE IF NOT EXISTS "custom_form_schemas" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
        "label" text NOT NULL,
        "schema" jsonb NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_by" uuid REFERENCES "users"("id"),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "archived_at" timestamp
      );
    `,
  },
  {
    label: 'INDEX custom_form_schemas_ws_idx',
    sql: `CREATE INDEX IF NOT EXISTS "custom_form_schemas_ws_idx" ON "custom_form_schemas" ("workspace_id", "archived_at");`,
  },
  // ── ai_submission_verdicts ─────────────────────────────────────
  {
    label: 'CREATE TABLE ai_submission_verdicts',
    sql: `
      CREATE TABLE IF NOT EXISTS "ai_submission_verdicts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "annotation_id" uuid NOT NULL REFERENCES "annotations"("id"),
        "judge_id" uuid REFERENCES "llm_judges"("id"),
        "status" text NOT NULL DEFAULT 'pending',
        "verdict" text,
        "scores" jsonb,
        "reasoning" text,
        "attempts" integer NOT NULL DEFAULT 0,
        "error_text" text,
        "idempotency_key" text NOT NULL,
        "started_at" timestamp NOT NULL DEFAULT now(),
        "finished_at" timestamp
      );
    `,
  },
  {
    label: 'UNIQUE INDEX ai_verdicts_idempotency_uniq',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "ai_verdicts_idempotency_uniq" ON "ai_submission_verdicts" ("idempotency_key");`,
  },
  {
    label: 'INDEX ai_verdicts_annotation_idx',
    sql: `CREATE INDEX IF NOT EXISTS "ai_verdicts_annotation_idx" ON "ai_submission_verdicts" ("annotation_id", "started_at" DESC);`,
  },
  {
    label: 'INDEX ai_verdicts_status_idx',
    sql: `CREATE INDEX IF NOT EXISTS "ai_verdicts_status_idx" ON "ai_submission_verdicts" ("status", "started_at");`,
  },
  // ── export_jobs ────────────────────────────────────────────────
  {
    label: 'CREATE TABLE export_jobs',
    sql: `
      CREATE TABLE IF NOT EXISTS "export_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
        "created_by" uuid REFERENCES "users"("id"),
        "format" text NOT NULL,
        "config" jsonb NOT NULL DEFAULT '{}',
        "status" text NOT NULL DEFAULT 'pending',
        "row_count" integer,
        "byte_size" integer,
        "storage_path" text,
        "error_text" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "finished_at" timestamp
      );
    `,
  },
  {
    label: 'INDEX export_jobs_ws_idx',
    sql: `CREATE INDEX IF NOT EXISTS "export_jobs_ws_idx" ON "export_jobs" ("workspace_id", "created_at" DESC);`,
  },
  {
    label: 'INDEX export_jobs_status_idx',
    sql: `CREATE INDEX IF NOT EXISTS "export_jobs_status_idx" ON "export_jobs" ("status", "created_at");`,
  },
]

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false })
  try {
     
    console.log(
      `[apply] connected, running ${STATEMENTS.length} statements`,
    )
    for (const stmt of STATEMENTS) {
      const t0 = Date.now()
       
      console.log(`[apply] ${stmt.label} …`)
      await sql.unsafe(stmt.sql)
       
      console.log(`[apply] ${stmt.label} ✓ (${Date.now() - t0}ms)`)
    }
    const [check] = await sql<
      Array<{
        custom_form_schemas: boolean
        ai_submission_verdicts: boolean
        export_jobs: boolean
        ai_review_enum: boolean
      }>
    >`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'custom_form_schemas') AS custom_form_schemas,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_submission_verdicts') AS ai_submission_verdicts,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'export_jobs') AS export_jobs,
        EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'workflow_stage' AND e.enumlabel = 'ai_review') AS ai_review_enum
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
