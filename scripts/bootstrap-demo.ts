/**
 * Bootstrap script — one-command demo setup for the proxy / SDK path.
 *
 * Run: `npm run bootstrap`
 *
 * What it does:
 *   1. Ensures the demo admin + demo workspace exist (same stable UUIDs as
 *      `npm run seed`, so this is composable with the full seed).
 *   2. Mints a NEW workspace API key, prints the plain bearer to stdout.
 *   3. Optionally rotates: pass --rotate to revoke any prior bootstrap keys
 *      before issuing a fresh one.
 *
 * Why separate from `seed`:
 *   - `seed` is heavy: synthetic trajectories, topics, tasks. Reseeding bumps
 *     metrics.
 *   - `bootstrap` is the minimum to make the proxy testable. Users may run
 *     this dozens of times during dev.
 *
 * Idempotency:
 *   - User + workspace creation: onConflictDoNothing on stable UUIDs.
 *   - API key: a NEW key on each run (keys are cheap; pairs cleanly with
 *     workspace_api_keys.lastUsedAt to spot active vs stale).
 *
 * Output: the script writes a copy-pasteable `curl` example to stdout, and
 * the plain key is shown ONCE (security: it is never logged on subsequent
 * runs). Make sure your terminal scroll is intact when you run it.
 */
// Load .env.local first (Next.js convention), then .env as fallback. tsx
// doesn't auto-load any of these — we do it explicitly so the same script
// works whether the user follows Next docs or the dotenv default.
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull, like } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema'

const DEMO_ADMIN_ID =
  process.env.SEED_ADMIN_ID ?? '00000000-0000-0000-0000-000000000001'
const DEMO_WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'

// Match the constants in src/lib/auth/api-key.ts. They aren't exported because
// that file is server-only, and importing it here would drag the entire
// 'server-only' chain into the script's CJS-ish runtime.
const API_KEY_PREFIX = 'lh_ws_'
const PREFIX_DISPLAY_LEN = 14

function mintKey() {
  const random = randomBytes(32).toString('base64url')
  const plain = `${API_KEY_PREFIX}${random}`
  const hash = createHash('sha256').update(plain).digest('hex')
  const prefix = plain.slice(0, PREFIX_DISPLAY_LEN)
  return { plain, hash, prefix }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(
      '\n❌ DATABASE_URL missing. Copy .env.example → .env.local and fill it in first.\n',
    )
    process.exit(1)
  }

  const rotate = process.argv.includes('--rotate')
  const keyName = `bootstrap-${new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '')}`

  const sql = postgres(url, { prepare: false })
  const db = drizzle(sql, { schema })

  console.log('\n🔑 LabelHub bootstrap\n')

  // 1. Ensure demo admin user (lightweight — no display name override).
  await db
    .insert(schema.users)
    .values({
      id: DEMO_ADMIN_ID,
      email: 'demo-admin@labelhub.local',
      displayName: 'Demo Admin',
    })
    .onConflictDoNothing()

  // 2. Ensure demo workspace.
  await db
    .insert(schema.workspaces)
    .values({
      id: DEMO_WORKSPACE_ID,
      name: 'Demo · Agent Trace Eval',
      templateMode: 'agent-trace-eval',
      adminId: DEMO_ADMIN_ID,
      settings: { bootstrap: true },
    })
    .onConflictDoNothing()

  console.log(`  workspace : ${DEMO_WORKSPACE_ID}`)
  console.log(`  admin     : ${DEMO_ADMIN_ID}`)

  // 3. Optional rotation — revoke prior bootstrap-issued keys for this workspace.
  if (rotate) {
    const revoked = await db
      .update(schema.workspaceApiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.workspaceApiKeys.workspaceId, DEMO_WORKSPACE_ID),
          like(schema.workspaceApiKeys.name, 'bootstrap-%'),
          isNull(schema.workspaceApiKeys.revokedAt),
        ),
      )
      .returning({ id: schema.workspaceApiKeys.id })
    console.log(`  rotated   : revoked ${revoked.length} prior bootstrap key(s)`)
  }

  // 4. Mint and insert a new key.
  const { plain, hash, prefix } = mintKey()
  const [row] = await db
    .insert(schema.workspaceApiKeys)
    .values({
      workspaceId: DEMO_WORKSPACE_ID,
      name: keyName,
      keyHash: hash,
      prefix,
      createdBy: DEMO_ADMIN_ID,
    })
    .returning({ id: schema.workspaceApiKeys.id })

  console.log(`  api key   : ${row.id}  (name: ${keyName})`)

  // ── Print the plain bearer + a copy-paste example ───────────────────────
  const port = process.env.PORT ?? '3000'
  const base = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`
  const exampleModel =
    process.env.DOUBAO_DEFAULT_MODEL ?? 'doubao-1-5-pro-32k-250115'

  console.log('\n────────────────────────────────────────────────────────────')
  console.log('  PLAIN BEARER (shown once — copy now):')
  console.log()
  console.log('  ' + plain)
  console.log('────────────────────────────────────────────────────────────\n')

  console.log('Try the Doubao proxy with curl:\n')
  console.log(`  curl -sS -X POST ${base}/api/proxy/doubao/chat/completions \\`)
  console.log(`    -H 'Authorization: Bearer ${plain}' \\`)
  console.log(`    -H 'Content-Type: application/json' \\`)
  console.log(`    -d '{"model":"${exampleModel}",`)
  console.log(`         "messages":[{"role":"user","content":"用一句话介绍你自己。"}]}'`)
  console.log()
  console.log(
    'After it returns, the captured trajectory is browsable in the workspace.',
  )
  console.log(`Workspace ID: ${DEMO_WORKSPACE_ID}\n`)

  await sql.end()
}

main().catch((e) => {
  console.error('\n❌ Bootstrap failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
