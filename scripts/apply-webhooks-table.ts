/**
 * One-off: apply the `workspace_webhooks` table to the live DB.
 *
 * `drizzle-kit push` is interactive and hangs in non-TTY contexts, so for
 * a single straightforward CREATE TABLE we just run the SQL directly.
 *
 * Idempotent: uses IF NOT EXISTS / IF NOT EXISTS so re-running is safe.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import postgres from 'postgres'

async function main() {
  const sql = postgres(process.env.DATABASE_URL || '', { prepare: false })
  await sql`
    create table if not exists workspace_webhooks (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id),
      url text not null,
      secret text not null,
      event_types jsonb not null default '[]'::jsonb,
      enabled boolean not null default true,
      created_by uuid not null references users(id),
      created_at timestamp not null default now(),
      last_delivery_at timestamp,
      last_delivery_status integer,
      failure_count integer not null default 0,
      revoked_at timestamp
    );
  `
  await sql`
    create index if not exists webhooks_workspace_idx
      on workspace_webhooks (workspace_id);
  `
  // Sanity check
  const [{ n }] = (await sql`
    select count(*)::int as n from workspace_webhooks
  `) as Array<{ n: number }>
  console.log(`workspace_webhooks ready — ${n} row${n === 1 ? '' : 's'}`)
  await sql.end()
}

main().catch((e) => {
  console.error('apply failed:', e)
  process.exit(1)
})
