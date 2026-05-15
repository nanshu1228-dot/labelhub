/**
 * Role-matrix MCP-walk seed.
 *
 * Creates four real Supabase auth users (admin/qc/annotator/viewer) in the
 * demo workspace plus one annotation in `submitted` state so the QC user
 * has something to pass / 打回 during the browser walkthrough.
 *
 * Idempotent — re-runnable. Existing users are reused (passwords are NOT
 * reset on re-run so you can iterate). Existing membership rows are
 * upserted to the requested role.
 *
 * Output: prints credentials + relevant URLs so the human (or MCP) can
 * sign in one-by-one and verify every role's surface.
 *
 * Cleanup: `npm run seed:role-matrix -- --cleanup` removes the four
 * users and their workspace_members rows. The dedicated task/topic
 * created for the walk is kept (cheap, useful as audit history).
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { createClient } from '@supabase/supabase-js'
import * as schema from '../src/lib/db/schema'

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'
const DEMO_ADMIN_ID = '00000000-0000-0000-0000-000000000001'

/**
 * Stable identities — same email = same auth user across re-runs, but the
 * `users.id` UUID is whatever Supabase mints on first signup. We mirror
 * that into our `users` table to satisfy the FK on workspace_members.
 */
const ACCOUNTS = [
  { role: 'admin' as const, email: 'admin-role-test@labelhub.dev' },
  { role: 'qc' as const, email: 'qc-role-test@labelhub.dev' },
  { role: 'annotator' as const, email: 'annotator-role-test@labelhub.dev' },
  { role: 'viewer' as const, email: 'viewer-role-test@labelhub.dev' },
]
const SHARED_PASSWORD = 'Role-test-pwd-2026!'

/** Dedicated task for the walk so we don't pollute the existing demo. */
const WALK_TASK_NAME = 'Role-Matrix Walk — QC test fixture'
const WALK_TOPIC_ITEM = {
  prompt: 'Rate the trajectory: did the agent correctly handle the user request?',
  context: 'Test fixture for MCP role-matrix walkthrough.',
}

async function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'Check .env.local.',
    )
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function getDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { prepare: false })
  return { db: drizzle(sql, { schema }), close: () => sql.end() }
}

async function ensureSupabaseUser(
  // The createClient generic gets resolved to a narrow shape that doesn't
  // match the runtime auth.admin surface. `any` here is pragmatic for a
  // throwaway seed; the real type-safety lives in the action layer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  email: string,
): Promise<string> {
  // Try to find existing user by email — `admin.listUsers` paginates 50/page.
  // For our fixture (4 users) the demo workspace has at most low-hundreds of
  // users, so a single page is enough.
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  })
  if (listErr) throw listErr
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = list.users.find((u: any) => u.email === email)
  if (existing) return existing.id

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: SHARED_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: email.split('@')[0] },
  })
  if (error) throw error
  if (!data.user) throw new Error('createUser returned no user')
  return data.user.id
}

async function deleteSupabaseUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  email: string,
) {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  })
  if (listErr) throw listErr
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = list.users.find((u: any) => u.email === email)
  if (!existing) return
  const { error } = await supabase.auth.admin.deleteUser(existing.id)
  if (error) throw error
}

async function main() {
  const cleanup = process.argv.includes('--cleanup')
  const supabase = await getServiceRoleClient()
  const { db, close } = await getDb()

  try {
    if (cleanup) {
      console.log('🧹 Cleaning up role-matrix users...')
      for (const acc of ACCOUNTS) {
        // Remove membership rows first (FK)
        const userRow = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, acc.email))
          .limit(1)
        if (userRow[0]) {
          await db
            .delete(schema.workspaceMembers)
            .where(
              and(
                eq(schema.workspaceMembers.workspaceId, WORKSPACE_ID),
                eq(schema.workspaceMembers.userId, userRow[0].id),
              ),
            )
          // Keep the `users` row — it might be referenced by events/annotations
          // (FK from events.actor_id). Just remove the supabase auth user;
          // the orphaned `users` row stays for audit history.
        }
        await deleteSupabaseUser(supabase, acc.email)
        console.log(`  ✓ removed ${acc.email}`)
      }
      console.log('Done.')
      return
    }

    console.log('🌱 Seeding role-matrix users into workspace', WORKSPACE_ID)

    const created: Array<{ role: string; email: string; id: string }> = []
    for (const acc of ACCOUNTS) {
      const supabaseUid = await ensureSupabaseUser(supabase, acc.email)
      // Mirror into our `users` table (same id as supabase auth).
      await db
        .insert(schema.users)
        .values({
          id: supabaseUid,
          email: acc.email,
          displayName: acc.email.split('@')[0],
        })
        .onConflictDoNothing()

      // Upsert membership: delete-then-insert handles role change between runs.
      await db
        .delete(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, WORKSPACE_ID),
            eq(schema.workspaceMembers.userId, supabaseUid),
          ),
        )
      await db.insert(schema.workspaceMembers).values({
        workspaceId: WORKSPACE_ID,
        userId: supabaseUid,
        role: acc.role,
        invitedBy: DEMO_ADMIN_ID,
      })
      created.push({ role: acc.role, email: acc.email, id: supabaseUid })
      console.log(`  ✓ ${acc.role.padEnd(10)} ${acc.email}  (${supabaseUid})`)
    }

    // ─── Build the walk fixture: a single submitted annotation by
    //     annotator-role-test, so QC has something to verdict on. ───
    const annotatorRow = created.find((c) => c.role === 'annotator')!

    // Find-or-create the walk task.
    let [task] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.workspaceId, WORKSPACE_ID),
          eq(schema.tasks.name, WALK_TASK_NAME),
        ),
      )
      .limit(1)
    if (!task) {
      ;[task] = await db
        .insert(schema.tasks)
        .values({
          workspaceId: WORKSPACE_ID,
          name: WALK_TASK_NAME,
          phase: 1,
          description:
            'Fixture task for MCP role-matrix walkthrough. Holds one submitted annotation so QC can pass / request_revision against it.',
          guidelinesMarkdown:
            '# Walk fixture\n\nRate the agent trajectory. This task exists for testing the role-matrix; not production data.',
          templateMode: 'agent-trace-eval',
          rewardConfig: {
            type: 'cash-per-item',
            currency: 'CNY',
            amount: 0,
            qualityMultiplierMin: 1.0,
            qualityMultiplierMax: 1.0,
          },
          status: 'open',
        })
        .returning()
      console.log(`  ✓ task created: ${task.id}`)
    }

    // Find-or-create the topic. Reset its status to `submitted` so the QC
    // walk has a fresh target every run.
    let [topic] = await db
      .select()
      .from(schema.topics)
      .where(eq(schema.topics.taskId, task.id))
      .limit(1)
    if (!topic) {
      ;[topic] = await db
        .insert(schema.topics)
        .values({
          taskId: task.id,
          itemData: WALK_TOPIC_ITEM,
          status: 'submitted',
          assignedTo: annotatorRow.id,
        })
        .returning()
      console.log(`  ✓ topic created: ${topic.id}`)
    } else {
      ;[topic] = await db
        .update(schema.topics)
        .set({
          status: 'submitted',
          assignedTo: annotatorRow.id,
          version: topic.version + 1,
        })
        .where(eq(schema.topics.id, topic.id))
        .returning()
      console.log(`  ✓ topic reset to 'submitted': ${topic.id}`)
    }

    // Find-or-create the annotation row.
    const annoPayload = { rating: 4, note: 'Looks mostly correct.' }
    let [annotation] = await db
      .select()
      .from(schema.annotations)
      .where(
        and(
          eq(schema.annotations.topicId, topic.id),
          eq(schema.annotations.userId, annotatorRow.id),
        ),
      )
      .limit(1)
    if (!annotation) {
      ;[annotation] = await db
        .insert(schema.annotations)
        .values({
          topicId: topic.id,
          userId: annotatorRow.id,
          payload: annoPayload,
          submittedAt: new Date(),
        })
        .returning()
      console.log(`  ✓ annotation created: ${annotation.id}`)
    }

    // ─── Print credentials + URLs ───
    const baseUrl =
      process.env.LABELHUB_BASE_URL ?? 'https://labelhub-gamma.vercel.app'

    console.log('\n┌─────────────────────────────────────────────────────────────────────┐')
    console.log('│  Role-matrix walk credentials                                       │')
    console.log('├─────────────────────────────────────────────────────────────────────┤')
    for (const c of created) {
      console.log(`│  ${c.role.padEnd(10)} ${c.email.padEnd(40)}              │`)
    }
    console.log(`│  password   ${SHARED_PASSWORD.padEnd(40)}                  │`)
    console.log('└─────────────────────────────────────────────────────────────────────┘')

    console.log('\n📋  Verify each role at:')
    console.log(`    base:        ${baseUrl}`)
    console.log(`    workspace:   ${baseUrl}/workspaces/${WORKSPACE_ID}`)
    console.log(`    quality:     ${baseUrl}/quality           (admin only)`)
    console.log(`    /my/queue:   ${baseUrl}/my/queue          (qc + annotator)`)
    console.log(
      `    review URL:  ${baseUrl}/workspaces/${WORKSPACE_ID}/trajectories/${topic.id}?annotationId=${annotation.id}`,
    )
    console.log('\n  Note: the review URL points at a topic id (no real trajectory).')
    console.log('  The inline QC verdict controls will render on any trajectory the')
    console.log('  reviewer opens with ?annotationId=<id>. For a real walk, use a')
    console.log('  trajectory id from the demo workspace.\n')

    console.log('  Expected behavior per role:')
    console.log('    admin     — can hit /quality, sees verdict controls on review')
    console.log('    qc        — /my/queue ok, sees QC verdict controls, /quality → 404/403')
    console.log('    annotator — /my/queue ok, no verdict controls, /quality → 404/403')
    console.log('    viewer    — no /my/queue, no verdict controls, /quality → 404/403\n')

    console.log('  Annotation seeded:')
    console.log(`    annotationId: ${annotation.id}`)
    console.log(`    topicId:      ${topic.id}`)
    console.log(`    status:       submitted`)
    console.log(`    submitter:    ${annotatorRow.email}\n`)
  } finally {
    await close()
  }
}

main().catch((e) => {
  console.error('\n❌ seed failed:', e)
  process.exit(1)
})
