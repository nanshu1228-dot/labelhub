/**
 * Seed real provider connections from .env.local keys.
 *
 * Reads DOUBAO_API_KEY / ANTHROPIC_API_KEY (whatever is set) and creates
 * a labelled connection in the demo workspace. Skips if a connection of
 * the same provider_kind already exists, so this is idempotent.
 *
 * Run: tsx scripts/_seed-connections.ts
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import postgres from 'postgres'

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'

async function ensureConnection(
  sql: ReturnType<typeof postgres>,
  opts: {
    providerKind: string
    displayName: string
    plainKey: string
    rpm?: number | null
  },
) {
  // Idempotent: skip if any enabled connection already exists for this kind.
  const existing = await sql`
    SELECT id, display_name FROM provider_connections
    WHERE workspace_id = ${WORKSPACE_ID}::uuid
      AND provider_kind = ${opts.providerKind}
      AND enabled = 'true'
    LIMIT 1
  `
  if (existing.length > 0) {
    console.log(
      `  · ${opts.providerKind}: already has connection "${existing[0].display_name}"`,
    )
    return
  }

  const vaultRef = `lh_provider_${opts.providerKind}_${Date.now()}`
  await sql`
    SELECT vault.create_secret(${opts.plainKey}, ${vaultRef}, ${'auto-seeded from .env.local'})
  `
  const [row] = await sql`
    INSERT INTO provider_connections
      (workspace_id, provider_kind, display_name, vault_ref, key_display, rate_limit_rpm)
    VALUES (
      ${WORKSPACE_ID}::uuid,
      ${opts.providerKind},
      ${opts.displayName},
      ${vaultRef},
      ${'…' + opts.plainKey.slice(-4)},
      ${opts.rpm ?? null}
    )
    RETURNING id, key_display
  `
  console.log(
    `  + ${opts.providerKind}: created "${opts.displayName}" (key ${row.key_display})`,
  )
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL || '', { prepare: false })

  console.log('seeding connections from .env.local:\n')

  const doubao = process.env.DOUBAO_API_KEY
  if (doubao && doubao.length > 8) {
    await ensureConnection(sql, {
      providerKind: 'doubao',
      displayName: 'Doubao primary',
      plainKey: doubao,
      rpm: 600, // ARK default
    })
  } else {
    console.log('  · doubao: no DOUBAO_API_KEY in .env.local, skipped')
  }

  const anthropic = process.env.ANTHROPIC_API_KEY
  if (anthropic && anthropic.length > 8) {
    await ensureConnection(sql, {
      providerKind: 'anthropic',
      displayName: 'Anthropic primary',
      plainKey: anthropic,
      rpm: 50, // typical Tier 1
    })
  } else {
    console.log('  · anthropic: no ANTHROPIC_API_KEY, skipped')
  }

  // List final state
  const all = await sql`
    SELECT provider_kind, display_name, key_display, rate_limit_rpm, enabled, last_used_at
    FROM provider_connections
    WHERE workspace_id = ${WORKSPACE_ID}::uuid
    ORDER BY provider_kind
  `
  console.log(`\nworkspace now has ${all.length} connection(s):`)
  for (const c of all) {
    console.log(
      `  · [${c.provider_kind}] ${c.display_name} (${c.key_display}, ${c.rate_limit_rpm ?? 'no'} rpm, ${c.enabled === 'true' ? 'on' : 'off'})`,
    )
  }

  await sql.end()
}

main().catch((e) => {
  console.error('failed:', e)
  process.exit(1)
})
