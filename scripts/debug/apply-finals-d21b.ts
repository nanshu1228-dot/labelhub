/**
 * Finals D21-B — Schema versioning + workspace template gallery.
 *
 * Adds two columns to custom_form_schemas (idempotent ADD COLUMN IF
 * NOT EXISTS) + a partial index for the workspace-template lookup:
 *
 *   - previous_id uuid  — append-only chain. updateCustomFormSchema
 *     INSERTs a new row pointing at the prior row's id; the prior
 *     row stays immutable so any task pinned to it keeps rendering
 *     the same schema. Closes spec section 5 "schema 版本管理".
 *
 *   - is_template boolean DEFAULT false — workspace template
 *     gallery. Designer "Save as template" toggles it; the
 *     "Start from template" dropdown lists OFFICIAL_TEMPLATES +
 *     workspace.isTemplate rows.
 *
 *   - INDEX custom_form_schemas_workspace_template_idx (workspace_id,
 *     is_template) WHERE archived_at IS NULL — narrows the
 *     listWorkspaceTemplates query to live, in-workspace templates.
 *
 * Same pooler-friendly direct-DDL pattern as apply-finals-d1.ts.
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
    label: 'ADD COLUMN custom_form_schemas.previous_id',
    sql: `
      ALTER TABLE "custom_form_schemas"
      ADD COLUMN IF NOT EXISTS "previous_id" uuid
        REFERENCES "custom_form_schemas"("id");
    `,
  },
  {
    label: 'ADD COLUMN custom_form_schemas.is_template',
    sql: `
      ALTER TABLE "custom_form_schemas"
      ADD COLUMN IF NOT EXISTS "is_template" boolean NOT NULL DEFAULT false;
    `,
  },
  {
    label: 'INDEX custom_form_schemas_workspace_template_idx',
    sql: `
      CREATE INDEX IF NOT EXISTS
        "custom_form_schemas_workspace_template_idx"
        ON "custom_form_schemas" ("workspace_id", "is_template")
        WHERE "archived_at" IS NULL;
    `,
  },
  {
    label: 'INDEX custom_form_schemas_previous_id_idx',
    sql: `
      CREATE INDEX IF NOT EXISTS
        "custom_form_schemas_previous_id_idx"
        ON "custom_form_schemas" ("previous_id")
        WHERE "previous_id" IS NOT NULL;
    `,
  },
]

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false })
  try {
    // eslint-disable-next-line no-console
    console.log(
      `[apply] connected, running ${STATEMENTS.length} statements`,
    )
    for (const stmt of STATEMENTS) {
      const t0 = Date.now()
      // eslint-disable-next-line no-console
      console.log(`[apply] ${stmt.label} …`)
      await sql.unsafe(stmt.sql)
      // eslint-disable-next-line no-console
      console.log(`[apply] ${stmt.label} ✓ (${Date.now() - t0}ms)`)
    }
    const [check] = await sql<
      Array<{
        previous_id_col: boolean
        is_template_col: boolean
        workspace_template_idx: boolean
      }>
    >`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='custom_form_schemas' AND column_name='previous_id'
        ) AS previous_id_col,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='custom_form_schemas' AND column_name='is_template'
        ) AS is_template_col,
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE indexname='custom_form_schemas_workspace_template_idx'
        ) AS workspace_template_idx
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
