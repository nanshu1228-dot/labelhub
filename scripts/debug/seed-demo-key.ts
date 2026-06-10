/**
 * Mint (or rotate) the public demo API key for the demo workspace.
 *
 * Phase-17 (17c): the landing snippet shows a `lh_demo_…` placeholder
 * that a judge can copy + curl. This script wires that promise up:
 *
 *   1. Find the existing demo workspace (uuid 0…0010).
 *   2. Revoke any prior demo key (idempotent re-run).
 *   3. Mint a fresh key plaintext + hash; insert into
 *      workspace_api_keys with rate_limit_rpm = 10.
 *   4. Stash the plaintext into workspaces.settings.demoApiKey
 *      so the landing page can read + display it.
 *
 * The plaintext lives in settings JSONB on purpose — the *whole point*
 * of a demo key is that it's public. Other workspaces never store
 * plaintext; this exception is opt-in for the demo only.
 *
 * Run: npx tsx scripts/debug/seed-demo-key.ts
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'

const DEMO_WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'
const DEMO_KEY_RPM = 10
const DEMO_KEY_NAME = 'Public demo key (rate-limited)'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
   
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

function mintKey(): { plain: string; hash: string; prefix: string } {
  // Distinct visible prefix `lh_demo_` (vs. regular `lh_ws_`) so a judge
  // can recognize at a glance "this is the rate-limited public key".
  const random = randomBytes(20).toString('base64url').slice(0, 26)
  const plain = `lh_demo_${random}`
  const hash = createHash('sha256').update(plain).digest('hex')
  const prefix = plain.slice(0, 14)
  return { plain, hash, prefix }
}

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false })
  try {
    // 1. Confirm demo workspace exists.
    const [ws] = await sql<
      Array<{ id: string; settings: Record<string, unknown> | null }>
    >`
      SELECT id, settings FROM workspaces WHERE id = ${DEMO_WORKSPACE_ID}
    `
    if (!ws) {
       
      console.error(
        `[seed-demo-key] demo workspace ${DEMO_WORKSPACE_ID} not found — run scripts/seed-demo.ts first`,
      )
      process.exit(1)
    }

    // 2. Revoke any prior demo key(s). Idempotent rotation.
    const revoked = await sql`
      UPDATE workspace_api_keys
      SET revoked_at = now()
      WHERE workspace_id = ${DEMO_WORKSPACE_ID}
        AND prefix LIKE 'lh_demo_%'
        AND revoked_at IS NULL
    `
     
    console.log(`[seed-demo-key] revoked ${revoked.count ?? 0} prior demo key(s)`)

    // 3. Find any user from the workspace to act as `created_by`. The
    //    column is NOT NULL but for a system-minted key we pick the
    //    workspace admin.
    const [admin] = await sql<Array<{ admin_id: string }>>`
      SELECT admin_id FROM workspaces WHERE id = ${DEMO_WORKSPACE_ID}
    `
    if (!admin?.admin_id) {
       
      console.error('[seed-demo-key] demo workspace has no admin')
      process.exit(1)
    }

    const { plain, hash, prefix } = mintKey()
    await sql`
      INSERT INTO workspace_api_keys (
        workspace_id, name, key_hash, prefix, created_by, rate_limit_rpm
      ) VALUES (
        ${DEMO_WORKSPACE_ID}, ${DEMO_KEY_NAME}, ${hash}, ${prefix},
        ${admin.admin_id}, ${DEMO_KEY_RPM}
      )
    `

    // 4. Stash plaintext into settings JSONB.
    //    Use Postgres `||` jsonb merge so a concurrent edit to other
    //    settings keys doesn't get clobbered (Phase-17 audit fix #F5).
    const patch = {
      demoApiKey: plain,
      demoApiKeyRpm: DEMO_KEY_RPM,
      demoApiKeyMintedAt: new Date().toISOString(),
    }
    await sql`
      UPDATE workspaces
      SET settings = coalesce(settings, '{}'::jsonb) || ${sql.json(patch)}::jsonb
      WHERE id = ${DEMO_WORKSPACE_ID}
    `
    void ws // keep the existence-check earlier; ws.settings no longer
    // read here since the merge happens server-side

     
    console.log('[seed-demo-key] ✓ minted', {
      workspaceId: DEMO_WORKSPACE_ID,
      prefix,
      rpm: DEMO_KEY_RPM,
      plain,
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
   
  console.error('[seed-demo-key] failed:', e)
  process.exit(1)
})
