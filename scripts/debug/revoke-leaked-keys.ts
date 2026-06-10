/**
 * Emergency revocation of two `lh_ws_*` keys that were committed
 * into the repo (README, DEMO_CHECKLIST, docs, scripts) before the
 * Phase-17 audit caught them.
 *
 * Leaked keys (full plaintext is git-history-public anyway, so
 * including here for traceability):
 *   - lh_ws_7fTnxnfKRZ7yP2BrOCD2W8E14GIQ6cFf-TgvU5pwTNQ
 *   - lh_ws_VaC9D3YeiRdtc5a7IpYsr1UFb_nv8HWucO84PxapO7c
 *
 * Action: hash each and set revoked_at=now() on the matching row.
 * Idempotent. Run once.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { createHash } from 'node:crypto'
import postgres from 'postgres'

const LEAKED = [
  'lh_ws_7fTnxnfKRZ7yP2BrOCD2W8E14GIQ6cFf-TgvU5pwTNQ',
  'lh_ws_VaC9D3YeiRdtc5a7IpYsr1UFb_nv8HWucO84PxapO7c',
]

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
   
  console.error('DATABASE_URL not set')
  process.exit(1)
}

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false })
  try {
    for (const plain of LEAKED) {
      const hash = createHash('sha256').update(plain).digest('hex')
      const result = await sql`
        UPDATE workspace_api_keys
        SET revoked_at = COALESCE(revoked_at, now())
        WHERE key_hash = ${hash}
        RETURNING id, prefix, workspace_id, revoked_at
      `
       
      console.log(`[revoke] ${plain.slice(0, 14)}…`, result)
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
   
  console.error('[revoke] failed:', e)
  process.exit(1)
})
