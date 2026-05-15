/**
 * Add 'awaiting_acceptance' to the workflow_stage Postgres enum.
 *
 * Postgres ALTER TYPE ... ADD VALUE is idempotent via IF NOT EXISTS,
 * so re-running this is safe.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import postgres from 'postgres'

async function main() {
  const sql = postgres(process.env.DATABASE_URL || '', { prepare: false })
  await sql.unsafe(
    "alter type workflow_stage add value if not exists 'awaiting_acceptance' before 'approved'",
  )
  console.log('workflow_stage enum: awaiting_acceptance ready')
  await sql.end()
}

main().catch((e) => {
  console.error('apply failed:', e)
  process.exit(1)
})
