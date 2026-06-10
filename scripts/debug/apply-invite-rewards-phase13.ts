/**
 * Phase-13 invite-reward automation DDL.
 *
 * One table: `invite_rewards`. Money-path feature — when an admin
 * approves an annotation, we check if the submitter was invited by
 * another user and whether they've now hit the 5-approval threshold;
 * if so, the inviter earns a ¥200 credit.
 *
 * Anti-abuse posture: rows can land as `manual_review` instead of
 * `granted` so admins gate suspicious cases (same email domain, fast
 * threshold burst, suspended inviter, …). One row per (inviter,
 * invitee, workspace) — unique index prevents double-credit.
 *
 * Idempotent (IF NOT EXISTS).
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
    label: 'CREATE TABLE invite_rewards',
    sql: `
      CREATE TABLE IF NOT EXISTS "invite_rewards" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "inviter_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "invitee_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
        "status" text NOT NULL DEFAULT 'pending',
        "block_reason" text,
        "amount_minor" integer NOT NULL,
        "currency" text NOT NULL,
        "trigger_annotation_id" uuid REFERENCES "annotations"("id"),
        "granted_at" timestamp,
        "reviewed_by" uuid REFERENCES "users"("id"),
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `,
  },
  {
    label: 'UNIQUE INDEX invite_rewards_pair_uniq',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "invite_rewards_pair_uniq" ON "invite_rewards" ("inviter_user_id", "invitee_user_id", "workspace_id");`,
  },
  {
    label: 'INDEX invite_rewards_inviter_idx',
    sql: `CREATE INDEX IF NOT EXISTS "invite_rewards_inviter_idx" ON "invite_rewards" ("inviter_user_id", "created_at" DESC);`,
  },
  {
    label: 'INDEX invite_rewards_workspace_idx',
    sql: `CREATE INDEX IF NOT EXISTS "invite_rewards_workspace_idx" ON "invite_rewards" ("workspace_id", "status");`,
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
    const [check] = await sql<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'invite_rewards'
      ) AS exists
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
