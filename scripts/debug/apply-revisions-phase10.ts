/**
 * Phase-10 annotation_revisions DDL. Idempotent + pooler-friendly.
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
    label: 'CREATE TABLE annotation_revisions',
    sql: `
      CREATE TABLE IF NOT EXISTS "annotation_revisions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "annotation_id" uuid NOT NULL REFERENCES "annotations"("id"),
        "actor_id" uuid NOT NULL REFERENCES "users"("id"),
        "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
        "payload" jsonb NOT NULL,
        "kind" text NOT NULL,
        "prev_revision_id" uuid,
        "byte_size" integer NOT NULL,
        "ts" timestamp DEFAULT now() NOT NULL
      );
    `.trim(),
  },
  {
    label: 'INDEX annotation_revisions_ann_ts_idx',
    sql: `CREATE INDEX IF NOT EXISTS "annotation_revisions_ann_ts_idx" ON "annotation_revisions" ("annotation_id", "ts");`,
  },
  {
    label: 'INDEX annotation_revisions_ann_kind_ts_idx',
    sql: `CREATE INDEX IF NOT EXISTS "annotation_revisions_ann_kind_ts_idx" ON "annotation_revisions" ("annotation_id", "kind", "ts");`,
  },
  {
    label: 'INDEX annotation_revisions_ws_ts_idx',
    sql: `CREATE INDEX IF NOT EXISTS "annotation_revisions_ws_ts_idx" ON "annotation_revisions" ("workspace_id", "ts");`,
  },
]

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false })
  try {
    // eslint-disable-next-line no-console
    console.log(`[apply] connected, running ${STATEMENTS.length} statements`)
    for (const stmt of STATEMENTS) {
      const t0 = Date.now()
      // eslint-disable-next-line no-console
      console.log(`[apply] ${stmt.label} …`)
      await sql.unsafe(stmt.sql)
      // eslint-disable-next-line no-console
      console.log(`[apply] ${stmt.label} ✓ (${Date.now() - t0}ms)`)
    }
    const [check] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'annotation_revisions'
      ) AS exists
    `
    // eslint-disable-next-line no-console
    console.log('[verify]', check)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[apply] failed:', e)
  process.exit(1)
})
