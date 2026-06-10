/**
 * One-off, idempotent, ADDITIVE migration: create the `withdrawal_requests`
 * table (+ FKs + indexes) on the target database.
 *
 * Why a hand-written script instead of `db:push` / `db:generate`:
 * this project's drizzle migration snapshot is vestigial (it only ever
 * tracked `notifications`; everything else was applied via `db:push`).
 * `db:generate` therefore emits a bogus "create-everything" migration, and
 * a full `db:push` diffs the ENTIRE schema against prod — too blunt for a
 * live DB. This script touches ONLY the new table, so it cannot affect any
 * existing table or data. Safe to re-run (IF NOT EXISTS + duplicate_object
 * guards).
 *
 * Usage:  DATABASE_URL=<prod> npx tsx scripts/apply-withdrawal-requests-table.ts
 */
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const sql = postgres(url, { max: 1 })

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS "withdrawal_requests" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "workspace_id" uuid NOT NULL,
    "amount_minor" integer NOT NULL,
    "currency" text NOT NULL,
    "payment_method_id" uuid,
    "status" text DEFAULT 'requested' NOT NULL,
    "reviewed_by_user_id" uuid,
    "reviewed_at" timestamp,
    "decision_memo" text,
    "txn_id" uuid,
    "external_ref" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `DO $$ BEGIN
     ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
     ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id");
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
     ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id");
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
     ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id");
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
     ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_txn_id_transactions_id_fk" FOREIGN KEY ("txn_id") REFERENCES "public"."transactions"("id");
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `CREATE INDEX IF NOT EXISTS "withdrawal_requests_user_idx" ON "withdrawal_requests" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "withdrawal_requests_ws_status_idx" ON "withdrawal_requests" ("workspace_id","status")`,
  `CREATE INDEX IF NOT EXISTS "withdrawal_requests_ws_created_idx" ON "withdrawal_requests" ("workspace_id","created_at")`,
]

async function main() {
  for (const stmt of statements) {
    await sql.unsafe(stmt)
  }
  const [{ exists }] = await sql`
    SELECT to_regclass('public.withdrawal_requests') IS NOT NULL AS exists
  `
  const cols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'withdrawal_requests'
    ORDER BY ordinal_position
  `
  console.log('withdrawal_requests exists:', exists)
  console.log('columns:', cols.map((c) => c.column_name).join(', '))
  await sql.end()
}

main().catch(async (e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e)
  await sql.end().catch(() => {})
  process.exit(1)
})
