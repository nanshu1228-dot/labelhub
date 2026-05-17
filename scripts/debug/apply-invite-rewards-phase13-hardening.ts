/**
 * Phase-13 follow-up hardening (post money-path audit).
 *
 *   1. CHECK constraint: invite_rewards.inviter_user_id <> invitee_user_id
 *      — belt-and-suspenders against self-invite credit. Application
 *      already guards in scanInviteRewardOnApproval, but a DB-level
 *      check stops any future code path (or a DBA hand-edit) from
 *      inserting a row that credits a user off their own annotations.
 *
 *   2. CHECK constraint: invite_rewards.amount_minor > 0 — can't grant
 *      a zero/negative bounty.
 *
 *   3. CHECK constraint: status in known values — prevents typos in
 *      future code paths from silently widening the state machine.
 *
 * All IF NOT EXISTS / re-runnable. Pooler-friendly direct DDL.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: 'CHECK no_self_invite_reward',
    sql: `
      ALTER TABLE "invite_rewards"
      DROP CONSTRAINT IF EXISTS "no_self_invite_reward";
      ALTER TABLE "invite_rewards"
      ADD CONSTRAINT "no_self_invite_reward"
      CHECK ("inviter_user_id" <> "invitee_user_id");
    `,
  },
  {
    label: 'CHECK positive_invite_amount',
    sql: `
      ALTER TABLE "invite_rewards"
      DROP CONSTRAINT IF EXISTS "positive_invite_amount";
      ALTER TABLE "invite_rewards"
      ADD CONSTRAINT "positive_invite_amount"
      CHECK ("amount_minor" > 0);
    `,
  },
  {
    label: 'CHECK invite_reward_status_known',
    sql: `
      ALTER TABLE "invite_rewards"
      DROP CONSTRAINT IF EXISTS "invite_reward_status_known";
      ALTER TABLE "invite_rewards"
      ADD CONSTRAINT "invite_reward_status_known"
      CHECK ("status" IN ('pending', 'manual_review', 'granted', 'blocked'));
    `,
  },
]

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false })
  try {
    // eslint-disable-next-line no-console
    console.log(`[apply] connected, running ${STATEMENTS.length} statements`)
    for (const stmt of STATEMENTS) {
      const t0 = Date.now()
      // eslint-disable-next-line no-console
      console.log(`[apply] ${stmt.label} …`)
      await sql.unsafe(stmt.sql)
      // eslint-disable-next-line no-console
      console.log(`[apply] ${stmt.label} ✓ (${Date.now() - t0}ms)`)
    }
    const [check] = await sql<
      Array<{
        self_invite: boolean
        positive_amt: boolean
        status_known: boolean
      }>
    >`
      SELECT
        EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'no_self_invite_reward') AS self_invite,
        EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positive_invite_amount') AS positive_amt,
        EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invite_reward_status_known') AS status_known
    `
    // eslint-disable-next-line no-console
    console.log('[verify]', check)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[apply] failed:', e)
  process.exit(1)
})
