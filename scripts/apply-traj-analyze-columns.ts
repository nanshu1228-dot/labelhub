/**
 * Apply new trajectory analysis columns (features / summary / summary_at /
 * summary_model) to the live DB. Idempotent.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import postgres from 'postgres'

async function main() {
  const sql = postgres(process.env.DATABASE_URL || '', { prepare: false })
  await sql`alter table trajectories
              add column if not exists features jsonb not null default '{}'::jsonb`
  await sql`alter table trajectories
              add column if not exists summary text`
  await sql`alter table trajectories
              add column if not exists summary_at timestamp`
  await sql`alter table trajectories
              add column if not exists summary_model text`
  console.log('trajectories: features / summary / summary_at / summary_model ready')
  await sql.end()
}

main().catch((e) => {
  console.error('apply failed:', e)
  process.exit(1)
})
