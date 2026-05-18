/**
 * Maintenance pass — add nextRetryAt column to workspace_webhooks for
 * exponential back-off.
 *
 * Previously: every workspace event fired a delivery to every enabled
 * hook regardless of past failures, until failureCount crossed 10 and
 * the hook auto-disabled. Under burst load (e.g. seeding 50 events in
 * a row) a dead receiver got 10 deliveries in seconds.
 *
 * Now: on failure, fanout sets nextRetryAt = now + min(30s * 2^N, 24h)
 * and subsequent attempts skip until nextRetryAt passes. The 10-strike
 * auto-disable remains as a permanent stop after the back-off has
 * given the receiver plenty of chances.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error('DATABASE_URL not set')
  process.exit(1)
}

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false })
  try {
    await sql.unsafe(
      `ALTER TABLE "workspace_webhooks"
       ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp;`,
    )
    // eslint-disable-next-line no-console
    console.log('[apply] workspace_webhooks.next_retry_at ✓')
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[apply] failed:', e)
  process.exit(1)
})
