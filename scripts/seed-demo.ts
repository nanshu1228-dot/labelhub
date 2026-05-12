/**
 * Demo seed script.
 *
 * Run: `npm run seed`
 * Requires: .env.local with DATABASE_URL set, schema already pushed (`npm run db:push`).
 *
 * Idempotent (re-runnable): uses stable UUIDs + onConflictDoNothing.
 *
 * Creates:
 *   - 1 demo admin user (id=00000000-...-001)
 *   - 1 workspace in `agent-trace-eval` mode
 *   - 1 published task
 *   - 3 hand-crafted trajectories (travel planner / math reasoning / code reviewer)
 *   - 3 inferred tool_providers
 *   - 3 topics linked to the trajectories (ready to be claimed by annotators)
 *   - 1 event for the task.published audit trail
 *
 * Notes:
 *   - The demo admin user has a fake id that does NOT match any Supabase auth user.
 *     For the seeded admin to log in via Supabase Auth, sign up via the UI first,
 *     then re-run this script with SEED_ADMIN_ID=<your real uuid>.
 *   - Bypasses the `server-only` ingest pipeline — uses Drizzle directly so the
 *     script runs in plain Node without Next.js context.
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema'

// ── Stable UUIDs for idempotent re-runs ─────────────────────────────────
const DEMO_ADMIN_ID =
  process.env.SEED_ADMIN_ID ?? '00000000-0000-0000-0000-000000000001'
const DEMO_WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'
const DEMO_TASK_ID = '00000000-0000-0000-0000-000000000020'
const TRAJ_TRAVEL = '00000000-0000-0000-0000-000000000100'
const TRAJ_MATH = '00000000-0000-0000-0000-000000000101'
const TRAJ_CODE = '00000000-0000-0000-0000-000000000102'
const TOPIC_TRAVEL = '00000000-0000-0000-0000-000000000200'
const TOPIC_MATH = '00000000-0000-0000-0000-000000000201'
const TOPIC_CODE = '00000000-0000-0000-0000-000000000202'

const PROVIDER_SEARCH_FLIGHTS = '00000000-0000-0000-0000-000000000300'
const PROVIDER_READ_FILE = '00000000-0000-0000-0000-000000000301'

// ── Hand-crafted trajectories (canonical shape) ─────────────────────────

type Step = {
  id: string
  sequence: number
  kind: string
  content: unknown
  toolCallId?: string | null
  toolProviderId?: string | null
}

interface DemoTrajectory {
  id: string
  agentName: string
  rootPrompt: string
  finalResponse: string
  steps: Step[]
}

const TRAJ_DEMOS: DemoTrajectory[] = [
  {
    id: TRAJ_TRAVEL,
    agentName: 'travel-planner-v2',
    rootPrompt: 'Plan a 3-day Tokyo trip for early March, mid-budget.',
    finalResponse:
      "Here's a 3-day Tokyo plan: Day 1 Asakusa + Skytree, Day 2 Shibuya + Harajuku, Day 3 Ueno Park + day trip to Kamakura. Hotel: Shibuya area, ~$120/night. Flights from US East ~$1100 RT.",
    steps: [
      {
        id: '00000000-0000-0000-0000-000000010100',
        sequence: 0,
        kind: 'thinking',
        content: {
          text: 'User wants Tokyo 3-day plan, early March, mid-budget. Let me search flights first then build itinerary.',
        },
      },
      {
        id: '00000000-0000-0000-0000-000000010101',
        sequence: 1,
        kind: 'tool_call',
        content: {
          toolCallId: 'tc_001',
          toolName: 'search_flights',
          args: {
            origin: 'JFK',
            destination: 'NRT',
            departDate: '2026-03-05',
            returnDate: '2026-03-08',
            budget: 'mid',
          },
          providerKind: 'function',
        },
        toolCallId: 'tc_001',
        toolProviderId: PROVIDER_SEARCH_FLIGHTS,
      },
      {
        id: '00000000-0000-0000-0000-000000010102',
        sequence: 2,
        kind: 'tool_result',
        content: {
          toolCallId: 'tc_001',
          output:
            '{"flights":[{"airline":"ANA","price_usd":1080,"duration":"14h"},{"airline":"JAL","price_usd":1145,"duration":"13h45m"}]}',
        },
        toolCallId: 'tc_001',
        toolProviderId: PROVIDER_SEARCH_FLIGHTS,
      },
      {
        id: '00000000-0000-0000-0000-000000010103',
        sequence: 3,
        kind: 'final_response',
        content: {
          text: "Here's a 3-day Tokyo plan: Day 1 Asakusa + Skytree, Day 2 Shibuya + Harajuku, Day 3 Ueno Park + day trip to Kamakura. Hotel: Shibuya area, ~$120/night. Flights from US East ~$1100 RT.",
        },
      },
    ],
  },
  {
    id: TRAJ_MATH,
    agentName: 'math-reasoner-v1',
    rootPrompt:
      "Find all integers n such that n² + n + 41 is prime, for 0 ≤ n ≤ 40.",
    finalResponse:
      'For 0 ≤ n ≤ 40, the polynomial n² + n + 41 evaluates to a prime for every value of n (Euler\'s lucky polynomial). At n = 40, it equals 1681 = 41², which is composite. So the answer is n ∈ {0, 1, 2, ..., 39}.',
    steps: [
      {
        id: '00000000-0000-0000-0000-000000010200',
        sequence: 0,
        kind: 'thinking',
        content: {
          text: 'This is Euler\'s prime-generating polynomial n²+n+41. Known to produce primes for n=0..39. At n=40 it equals 41², composite.',
        },
      },
      {
        id: '00000000-0000-0000-0000-000000010201',
        sequence: 1,
        kind: 'thinking',
        content: {
          text: 'Verify n=40: 40²+40+41 = 1600+40+41 = 1681 = 41². So 40 fails. All n in 0..39 give primes.',
        },
      },
      {
        id: '00000000-0000-0000-0000-000000010202',
        sequence: 2,
        kind: 'final_response',
        content: {
          text: "For 0 ≤ n ≤ 40, the polynomial n² + n + 41 evaluates to a prime for every value of n (Euler's lucky polynomial). At n = 40, it equals 1681 = 41², which is composite. So the answer is n ∈ {0, 1, 2, ..., 39}.",
        },
      },
    ],
  },
  {
    id: TRAJ_CODE,
    agentName: 'code-reviewer-v3',
    rootPrompt:
      "Review @lib/auth.py — check for security issues, especially around password handling.",
    finalResponse:
      "Found 2 issues: (1) `hash_password` uses unsalted MD5 — replace with bcrypt or argon2. (2) `verify_password` is not timing-safe — use `hmac.compare_digest`. Plus a nit: `password` arg should be typed `str` with min length 8.",
    steps: [
      {
        id: '00000000-0000-0000-0000-000000010300',
        sequence: 0,
        kind: 'thinking',
        content: {
          text: 'User wants security review of auth.py with focus on password handling. Read the file first.',
        },
      },
      {
        id: '00000000-0000-0000-0000-000000010301',
        sequence: 1,
        kind: 'tool_call',
        content: {
          toolCallId: 'tc_001',
          toolName: 'read_file',
          args: { path: 'lib/auth.py' },
          providerKind: 'function',
        },
        toolCallId: 'tc_001',
        toolProviderId: PROVIDER_READ_FILE,
      },
      {
        id: '00000000-0000-0000-0000-000000010302',
        sequence: 2,
        kind: 'tool_result',
        content: {
          toolCallId: 'tc_001',
          output:
            'import hashlib\n\ndef hash_password(p):\n    return hashlib.md5(p.encode()).hexdigest()\n\ndef verify_password(stored, given):\n    return stored == hash_password(given)\n',
        },
        toolCallId: 'tc_001',
        toolProviderId: PROVIDER_READ_FILE,
      },
      {
        id: '00000000-0000-0000-0000-000000010303',
        sequence: 3,
        kind: 'thinking',
        content: {
          text: 'Two clear issues: unsalted MD5 (cryptographically broken for passwords) + non-constant-time comparison (timing attack). Also missing type hints + length validation.',
        },
      },
      {
        id: '00000000-0000-0000-0000-000000010304',
        sequence: 4,
        kind: 'final_response',
        content: {
          text: "Found 2 issues: (1) `hash_password` uses unsalted MD5 — replace with bcrypt or argon2. (2) `verify_password` is not timing-safe — use `hmac.compare_digest`. Plus a nit: `password` arg should be typed `str` with min length 8.",
        },
      },
    ],
  },
]

// ── Tool provider declarations ──────────────────────────────────────────

const PROVIDERS = [
  {
    id: PROVIDER_SEARCH_FLIGHTS,
    kind: 'function',
    identifier: 'function:search_flights',
    name: 'search_flights',
    manifest: {
      description: 'Search for flights between two airports',
      schema: {
        type: 'object',
        properties: {
          origin: { type: 'string' },
          destination: { type: 'string' },
          departDate: { type: 'string', format: 'date' },
          returnDate: { type: 'string', format: 'date' },
          budget: { type: 'string', enum: ['low', 'mid', 'high'] },
        },
      },
    },
    source: 'declared',
  },
  {
    id: PROVIDER_READ_FILE,
    kind: 'function',
    identifier: 'function:read_file',
    name: 'read_file',
    manifest: {
      description: 'Read the contents of a file from the workspace',
      schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
      },
    },
    source: 'declared',
  },
]

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(
      '❌ DATABASE_URL missing. Copy .env.example → .env.local and fill in.',
    )
    process.exit(1)
  }

  const sql = postgres(url, { prepare: false })
  const db = drizzle(sql, { schema })

  console.log('🌱 Seeding LabelHub demo data...')

  // 1. Demo admin user
  await db
    .insert(schema.users)
    .values({
      id: DEMO_ADMIN_ID,
      email: 'demo-admin@labelhub.local',
      displayName: 'Demo Admin',
    })
    .onConflictDoNothing()
  console.log('  ✓ users')

  // 2. Demo workspace (agent-trace-eval mode)
  await db
    .insert(schema.workspaces)
    .values({
      id: DEMO_WORKSPACE_ID,
      name: 'Demo · Agent Trace Eval',
      templateMode: 'agent-trace-eval',
      adminId: DEMO_ADMIN_ID,
      settings: { seed: true },
    })
    .onConflictDoNothing()
  console.log('  ✓ workspaces')

  // 3. Demo task
  await db
    .insert(schema.tasks)
    .values({
      id: DEMO_TASK_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      name: 'Sample Agent Eval — Multi-domain',
      phase: 1,
      description:
        'Evaluate three agent trajectories across travel planning, math reasoning, and code review.',
      guidelinesMarkdown:
        '# Guidelines\n\n- Rate each step: correct / suspicious / wrong\n- Rate overall path: optimal / suboptimal / incorrect\n- Rate final answer: correct / partial / incorrect',
      templateMode: 'agent-trace-eval',
      rewardConfig: {
        type: 'cash-per-item',
        currency: 'CNY',
        amount: 25,
        qualityMultiplierMin: 1.0,
        qualityMultiplierMax: 2.0,
      },
      status: 'open',
    })
    .onConflictDoNothing()
  console.log('  ✓ tasks')

  // 4. Tool providers (declared)
  for (const p of PROVIDERS) {
    await db
      .insert(schema.toolProviders)
      .values({
        id: p.id,
        workspaceId: DEMO_WORKSPACE_ID,
        kind: p.kind,
        identifier: p.identifier,
        name: p.name,
        manifest: p.manifest,
        source: p.source,
      })
      .onConflictDoNothing()
  }
  console.log(`  ✓ tool_providers (${PROVIDERS.length})`)

  // 5. Trajectories + steps
  for (const traj of TRAJ_DEMOS) {
    await db
      .insert(schema.trajectories)
      .values({
        id: traj.id,
        workspaceId: DEMO_WORKSPACE_ID,
        taskId: DEMO_TASK_ID,
        source: 'synthetic',
        agentName: traj.agentName,
        rootPrompt: traj.rootPrompt,
        finalResponse: traj.finalResponse,
        meta: { seeded: true },
        schemaVersion: '1.0',
      })
      .onConflictDoNothing()

    for (const step of traj.steps) {
      await db
        .insert(schema.trajectorySteps)
        .values({
          id: step.id,
          trajectoryId: traj.id,
          sequence: step.sequence,
          kind: step.kind,
          content: step.content,
          toolCallId: step.toolCallId ?? null,
          toolProviderId: step.toolProviderId ?? null,
        })
        .onConflictDoNothing()
    }
  }
  console.log(
    `  ✓ trajectories (${TRAJ_DEMOS.length}) + steps (${TRAJ_DEMOS.reduce((n, t) => n + t.steps.length, 0)})`,
  )

  // 6. Topics binding trajectories to the task
  const TOPICS = [
    { id: TOPIC_TRAVEL, trajectoryId: TRAJ_TRAVEL },
    { id: TOPIC_MATH, trajectoryId: TRAJ_MATH },
    { id: TOPIC_CODE, trajectoryId: TRAJ_CODE },
  ]
  for (const topic of TOPICS) {
    await db
      .insert(schema.topics)
      .values({
        id: topic.id,
        taskId: DEMO_TASK_ID,
        itemData: { trajectoryId: topic.trajectoryId },
        status: 'drafting',
      })
      .onConflictDoNothing()
  }
  console.log(`  ✓ topics (${TOPICS.length})`)

  // 7. Audit event
  await db.insert(schema.events).values({
    type: 'seed.run',
    workspaceId: DEMO_WORKSPACE_ID,
    actorId: DEMO_ADMIN_ID,
    payload: { trajectoriesInserted: TRAJ_DEMOS.length },
  })

  // Verify
  const trajCount = await db
    .select()
    .from(schema.trajectories)
    .where(eq(schema.trajectories.workspaceId, DEMO_WORKSPACE_ID))
  console.log(
    `\n✅ Done. Workspace has ${trajCount.length} trajectories ready for annotation.`,
  )
  console.log(`   Workspace ID: ${DEMO_WORKSPACE_ID}`)
  console.log(`   Task ID:      ${DEMO_TASK_ID}`)
  console.log(`   Admin ID:     ${DEMO_ADMIN_ID}`)
  console.log(
    `\n👉 To log in as the demo admin, sign up via the UI with this email:`,
  )
  console.log(`   demo-admin@labelhub.local`)
  console.log(
    `   then re-run: SEED_ADMIN_ID=<your-supabase-uuid> npm run seed`,
  )

  await sql.end()
}

main().catch((e) => {
  console.error('Seed failed:', e)
  process.exit(1)
})
