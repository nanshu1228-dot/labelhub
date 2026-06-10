/**
 * One-shot seed for finals submission: create a real Supabase Auth
 * user (email-confirmed, no signup email) and add them as admin to
 * the finals demo workspace.
 *
 * Why this exists: the finals demo URL is hosted in CN where Supabase
 * confirmation emails can be flaky (mail.app.supabase.io delivery to
 * Chinese inboxes is intermittent). Pre-seeding a judge account with
 * a known password sidesteps email entirely.
 *
 *   JUDGE_EMAIL=judge@labelhub.demo JUDGE_PASSWORD='LabelHub2026!' \
 *     npm run seed:judge-user
 *
 * Idempotent — if the user already exists in Supabase Auth, we reuse
 * their id; if their workspace_members row already exists, we skip.
 *
 * Required env (must be set in /etc/labelhub.env or .env.local):
 *   - DATABASE_URL
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY  (admin API access — keep secret)
 *
 * Pre-req: `npm run seed:finals-demo` must have been run so the demo
 * workspace exists.
 */

import 'dotenv/config'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '../src/lib/db/schema'

// Mirrors the derivation in seed-finals-demo.ts so we resolve to the
// SAME workspace UUID — UUIDv5 over the same namespace + 'workspace'.
const SEED_NS = 'labelhub.seed.finals'
function derivedUuid(name: string): string {
  const h = createHash('sha1').update(`${SEED_NS}:${name}`).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const hex = h.toString('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const DEMO_WORKSPACE_ID = derivedUuid('workspace')

async function main() {
  const email = process.env.JUDGE_EMAIL ?? 'judge@labelhub.demo'
  const password = process.env.JUDGE_PASSWORD ?? 'LabelHub2026!'
  const displayName = process.env.JUDGE_NAME ?? 'Demo Judge'
  const role = (process.env.JUDGE_ROLE ?? 'admin') as
    | 'admin'
    | 'qc'
    | 'annotator'
    | 'viewer'

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const dbUrl = process.env.DATABASE_URL
  if (!supabaseUrl || !serviceKey || !dbUrl) {
    console.error(
      '❌ Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL.',
    )
    process.exit(1)
  }

  console.log(`🌱 Seeding judge user: ${email}`)

  // ── 1. Supabase Auth: create-or-reuse ─────────────────────────────
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let userId: string
  const created = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip the confirmation-email round trip
    user_metadata: { display_name: displayName },
  })

  if (created.error) {
    // Most common: 422 "already registered". Look the user up + reuse.
    const msg = created.error.message ?? ''
    const isDuplicate =
      created.error.status === 422 ||
      /already|exists|duplicate/i.test(msg)
    if (!isDuplicate) {
      console.error('❌ supabase admin.createUser failed:', msg)
      process.exit(1)
    }
    // listUsers paginates; for finals demo the project has very few
    // users so one page suffices.
    const list = await supabase.auth.admin.listUsers({ perPage: 200 })
    const found = list.data?.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    )
    if (!found) {
      console.error(
        '❌ user said "already exists" but listUsers couldn\'t find them.',
        msg,
      )
      process.exit(1)
    }
    userId = found.id
    console.log(`  ✓ supabase auth user already exists (id=${userId})`)
  } else {
    userId = created.data.user!.id
    console.log(`  ✓ created supabase auth user (id=${userId})`)
  }

  // ── 2. Mirror in public.users ─────────────────────────────────────
  const sql = postgres(dbUrl, { prepare: false })
  const db = drizzle(sql, { schema })

  let wsName = '(demo workspace)'
  try {
    await db
      .insert(schema.users)
      .values({ id: userId, email, displayName })
      .onConflictDoNothing()
    console.log('  ✓ public.users row')

    // ── 3. Workspace membership ─────────────────────────────────────
    const ws = await db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, DEMO_WORKSPACE_ID),
    })
    if (!ws) {
      console.error(
        `❌ demo workspace not found (id=${DEMO_WORKSPACE_ID}).\n` +
          '   Run `npm run seed:finals-demo` first to create it.',
      )
      process.exit(1)
    }
    wsName = ws.name

    await db
      .insert(schema.workspaceMembers)
      .values({
        workspaceId: DEMO_WORKSPACE_ID,
        userId,
        role,
      })
      .onConflictDoNothing()
    console.log(`  ✓ workspace_members row (role=${role})`)
  } finally {
    await sql.end()
  }

  console.log('\n✅ Judge account ready. Demo credentials:\n')
  console.log(`     URL:      http://163.7.5.149/signin`)
  console.log(`     Email:    ${email}`)
  console.log(`     Password: ${password}`)
  console.log(`     Role:     ${role} on workspace ${wsName}\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
