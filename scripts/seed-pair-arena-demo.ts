/**
 * Seed two demo workspaces for the new template modes:
 *   - `pair-rubric` workspace with a few prompt/A/B topics for yes/no checks
 *   - `arena-gsb`   workspace with a few prompt/A/B topics for 1-5 dim scoring
 *
 * Both reuse the four role-matrix test users created by
 * scripts/seed-role-matrix-users.ts, so the same login flow that
 * verified the trajectory walkthrough can verify these too.
 *
 * Idempotent — workspaces and their tasks use stable UUIDs; topics get
 * fresh UUIDs each run only if the count would drop. Re-running rebuilds
 * the topic set so freshly-seeded data is always submittable.
 *
 * Run: `npm run seed:pair-arena` (cleanup: append --cleanup).
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema'

const DEMO_ADMIN_ID = '00000000-0000-0000-0000-000000000001'

const PAIR_RUBRIC_WS = '00000000-0000-0000-0000-0000000000a0'
const PAIR_RUBRIC_TASK = '00000000-0000-0000-0000-0000000000a1'

const ARENA_GSB_WS = '00000000-0000-0000-0000-0000000000b0'
const ARENA_GSB_TASK = '00000000-0000-0000-0000-0000000000b1'

const ROLE_USERS = [
  'admin-role-test@labelhub.dev',
  'qc-role-test@labelhub.dev',
  'annotator-role-test@labelhub.dev',
  'viewer-role-test@labelhub.dev',
] as const

const PAIR_RUBRIC_TOPICS = [
  {
    prompt:
      'How many provinces does China have? List them by region (North/East/South/West/Central).',
    responseA: {
      modelName: 'doubao-seed-2',
      content:
        'China has 23 provinces, organized roughly as: North (Hebei, Shanxi, Liaoning, Jilin, Heilongjiang, Shandong); East (Jiangsu, Zhejiang, Anhui, Fujian, Jiangxi); South (Guangdong, Hainan, Taiwan); West (Sichuan, Yunnan, Guizhou, Shaanxi, Gansu, Qinghai); Central (Henan, Hubei, Hunan). Note: Taiwan is administered separately. Beijing/Shanghai/Tianjin/Chongqing are direct-administered municipalities, not provinces. Tibet/Xinjiang/Inner Mongolia/Ningxia/Guangxi are autonomous regions. Hong Kong and Macau are SARs.',
    },
    responseB: {
      modelName: 'gpt-4o',
      content:
        "China is divided into 22 provinces (excluding Taiwan, which the PRC claims but doesn't administer). North: Hebei, Shanxi, Liaoning, Jilin, Heilongjiang. East: Shandong, Jiangsu, Zhejiang, Anhui, Fujian, Jiangxi. South: Guangdong, Hainan. West: Sichuan, Yunnan, Guizhou, Shaanxi, Gansu, Qinghai. Central: Henan, Hubei, Hunan. There are also 4 municipalities, 5 autonomous regions, and 2 SARs.",
    },
  },
  {
    prompt:
      'Write a one-paragraph explanation of why the sky is blue, suitable for a 10-year-old.',
    responseA: {
      modelName: 'doubao-seed-2',
      content:
        'The sky looks blue because of how sunlight bounces off the air. Sunlight is actually made of all colors mixed together — like a rainbow. When it hits the air around Earth, the blue color gets scattered the most because of how short its waves are. Imagine throwing a bunch of different-sized balls into a forest: the small ones bounce around more and reach you from every direction. That\'s why when you look up, you see blue from all over the sky.',
    },
    responseB: {
      modelName: 'gpt-4o',
      content:
        'Light from the sun looks white but is made of every color. When it hits gas in the atmosphere, the gas particles scatter blue light more than other colors (this is called Rayleigh scattering). That scattered blue light reaches your eyes from every direction in the sky, so the sky appears blue.',
    },
  },
  {
    prompt:
      'My grandmother is 78 and has been feeling dizzy for 3 days. What should I do?',
    responseA: {
      modelName: 'doubao-seed-2',
      content:
        "I'm not a doctor, but persistent dizziness in someone your grandmother's age warrants prompt medical evaluation. A few practical steps: (1) call her primary care physician today and describe the duration + any associated symptoms (chest pain, slurred speech, vision changes, severe headache — these would mean immediate ER). (2) Make sure she's drinking water and hasn't recently changed medications. (3) Keep her sitting/lying down to prevent falls. Don't try to diagnose this at home; book the appointment.",
    },
    responseB: {
      modelName: 'gpt-4o',
      content:
        "Dizziness in elderly people can be caused by lots of things. Try some ginger tea and have her rest. If it doesn't get better in a few more days, maybe see a doctor.",
    },
  },
  {
    prompt:
      'Translate to French: "I would like to book a table for two at 7pm tomorrow."',
    responseA: {
      modelName: 'doubao-seed-2',
      content:
        "Je voudrais réserver une table pour deux personnes à 19 heures demain.",
    },
    responseB: {
      modelName: 'gpt-4o',
      content:
        "J'aimerais réserver une table pour deux à 7 heures demain soir.",
    },
  },
]

const ARENA_GSB_TOPICS = [
  {
    prompt:
      'Write a poem (8 lines max) about an old lighthouse that has stopped working.',
    responseA: {
      modelName: 'claude-sonnet-4.6',
      content:
        'Salt-pitted, the keeper of nothing,\nholds its silence over the bay.\nGulls remember where to circle —\nthe lamp does not.\nMoss has won the long argument\nwith iron, with stone, with paint.\nOnly the wind keeps coming\nas if expecting to be answered.',
    },
    responseB: {
      modelName: 'gpt-4o',
      content:
        'The lighthouse stands alone and dim,\nno longer guiding ships at sea.\nIts light has faded, weak and grim,\na silent watcher by the quay.\nOnce proud and bright against the storm,\nnow rust and silence are its norm.\nThe waves still crash, the seagulls cry,\nbut its bright beacon has said goodbye.',
    },
  },
  {
    prompt:
      'Explain in 100 words: why is the Riemann hypothesis still unsolved?',
    responseA: {
      modelName: 'claude-sonnet-4.6',
      content:
        "Riemann's hypothesis says every nontrivial zero of the zeta function lies on a single vertical line. The zeta function is built from primes, so the conjecture would lock in the deepest structure of how primes are distributed. The trouble is that direct calculation only verifies the first ~10^13 zeros; we've found no zero off the line, but \"none in a huge initial segment\" doesn't prove \"none anywhere.\" The known tools — explicit formulas, random-matrix analogues, L-function families — each produce evidence but no proof. The conjecture sits at the convergence of several deep theories, none yet sharp enough to close it.",
    },
    responseB: {
      modelName: 'gpt-4o',
      content:
        "The Riemann hypothesis remains open because it concerns the distribution of nontrivial zeros of the Riemann zeta function, all of which are conjectured to lie on the critical line Re(s) = 1/2. Despite extensive numerical verification and connections to prime numbers, no general proof has been found. The hypothesis links deep areas of mathematics — analytic number theory, complex analysis, and even physics — but no current technique captures the precise structure required. It remains one of the seven Millennium Prize Problems.",
    },
  },
  {
    prompt:
      'Give me three concrete experiments I could run this week to improve my morning focus.',
    responseA: {
      modelName: 'claude-sonnet-4.6',
      content:
        '1. **Phone in another room until your first deep-work block ends.** Track: at the end of the day, write down how many times you reached for it and what for. The data is the experiment.\n\n2. **Fixed wake-and-start time for 5 days.** Pick something realistic (7:00 wake, 7:30 at desk), and protect it from anything optional. Note which day breaks first and why — that\'s your real bottleneck.\n\n3. **One 25-min focus block first thing, on the single most-avoided task.** Before coffee, before email. End-of-week: was it as bad as the avoidance suggested? Almost always: no.',
    },
    responseB: {
      modelName: 'gpt-4o',
      content:
        'Sure! Here are some ideas:\n\n1. Try waking up earlier — say 30 minutes earlier than usual. See how your day feels.\n2. Drink water first thing in the morning before coffee.\n3. Make a to-do list each morning so you know what to focus on.\n\nGood luck!',
    },
  },
]

async function getDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { prepare: false })
  return { db: drizzle(sql, { schema }), close: () => sql.end() }
}

async function lookupRoleUserIds(
  db: ReturnType<typeof drizzle<typeof schema>>,
) {
  const rows = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(inArray(schema.users.email, [...ROLE_USERS]))
  const byEmail = new Map(rows.map((r) => [r.email, r.id]))
  const adminId = byEmail.get('admin-role-test@labelhub.dev')
  if (!adminId) {
    throw new Error(
      'Role-matrix users missing — run `npm run seed:role-matrix` first.',
    )
  }
  return { byEmail, adminId }
}

async function upsertWorkspace(
  db: ReturnType<typeof drizzle<typeof schema>>,
  id: string,
  name: string,
  templateMode: string,
  adminId: string,
) {
  await db
    .insert(schema.workspaces)
    .values({
      id,
      name,
      adminId,
      templateMode,
    })
    .onConflictDoNothing()
  // Force the templateMode to match what this seed claims (handles re-tagging).
  await db
    .update(schema.workspaces)
    .set({ templateMode, name })
    .where(eq(schema.workspaces.id, id))
}

async function ensureMembership(
  db: ReturnType<typeof drizzle<typeof schema>>,
  workspaceId: string,
  byEmail: Map<string, string>,
  invitedBy: string,
) {
  const roleByEmail: Record<string, string> = {
    'admin-role-test@labelhub.dev': 'admin',
    'qc-role-test@labelhub.dev': 'qc',
    'annotator-role-test@labelhub.dev': 'annotator',
    'viewer-role-test@labelhub.dev': 'viewer',
  }
  for (const [email, role] of Object.entries(roleByEmail)) {
    const userId = byEmail.get(email)
    if (!userId) continue
    await db
      .delete(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, workspaceId),
          eq(schema.workspaceMembers.userId, userId),
        ),
      )
    await db.insert(schema.workspaceMembers).values({
      workspaceId,
      userId,
      role,
      invitedBy,
    })
  }
}

async function upsertTask(
  db: ReturnType<typeof drizzle<typeof schema>>,
  id: string,
  workspaceId: string,
  name: string,
  templateMode: string,
) {
  await db
    .insert(schema.tasks)
    .values({
      id,
      workspaceId,
      name,
      phase: 1,
      description: `Demo task for the ${templateMode} template.`,
      guidelinesMarkdown: `# ${templateMode} demo\n\nFollow the rubric. Reasoning required where prompted.`,
      templateMode,
      rewardConfig: {
        type: 'cash-per-item',
        currency: 'CNY',
        amount: 10,
        qualityMultiplierMin: 1.0,
        qualityMultiplierMax: 1.5,
      },
      status: 'open',
    })
    .onConflictDoNothing()
}

async function rebuildTopics(
  db: ReturnType<typeof drizzle<typeof schema>>,
  taskId: string,
  items: ReadonlyArray<Record<string, unknown>>,
) {
  // Wipe existing topics + their annotations to reset the demo state.
  const existing = await db
    .select({ id: schema.topics.id })
    .from(schema.topics)
    .where(eq(schema.topics.taskId, taskId))
  const topicIds = existing.map((r) => r.id)
  if (topicIds.length > 0) {
    await db
      .delete(schema.annotations)
      .where(inArray(schema.annotations.topicId, topicIds))
    await db
      .delete(schema.topics)
      .where(inArray(schema.topics.id, topicIds))
  }
  for (const itemData of items) {
    await db.insert(schema.topics).values({
      taskId,
      itemData,
      status: 'drafting',
    })
  }
}

async function main() {
  const cleanup = process.argv.includes('--cleanup')
  const { db, close } = await getDb()
  try {
    if (cleanup) {
      // Drop topics + annotations + tasks + members + workspaces in order
      for (const taskId of [PAIR_RUBRIC_TASK, ARENA_GSB_TASK]) {
        const topicRows = await db
          .select({ id: schema.topics.id })
          .from(schema.topics)
          .where(eq(schema.topics.taskId, taskId))
        const tids = topicRows.map((r) => r.id)
        if (tids.length > 0) {
          await db
            .delete(schema.annotations)
            .where(inArray(schema.annotations.topicId, tids))
          await db
            .delete(schema.topics)
            .where(inArray(schema.topics.id, tids))
        }
        await db
          .delete(schema.tasks)
          .where(eq(schema.tasks.id, taskId))
      }
      for (const wsId of [PAIR_RUBRIC_WS, ARENA_GSB_WS]) {
        await db
          .delete(schema.workspaceMembers)
          .where(eq(schema.workspaceMembers.workspaceId, wsId))
        await db
          .delete(schema.workspaces)
          .where(eq(schema.workspaces.id, wsId))
      }
      console.log('🧹 Cleaned up pair-rubric + arena-gsb demo workspaces.')
      return
    }

    const { byEmail, adminId } = await lookupRoleUserIds(db)

    // ── Pair-Rubric demo
    await upsertWorkspace(
      db,
      PAIR_RUBRIC_WS,
      'Demo · Pair-Rubric',
      'pair-rubric',
      DEMO_ADMIN_ID,
    )
    await ensureMembership(db, PAIR_RUBRIC_WS, byEmail, adminId)
    await upsertTask(
      db,
      PAIR_RUBRIC_TASK,
      PAIR_RUBRIC_WS,
      'Q&A · Rubric Check (Phase 1)',
      'pair-rubric',
    )
    await rebuildTopics(db, PAIR_RUBRIC_TASK, PAIR_RUBRIC_TOPICS)

    // ── Arena-GSB demo
    await upsertWorkspace(
      db,
      ARENA_GSB_WS,
      'Demo · Arena-GSB',
      'arena-gsb',
      DEMO_ADMIN_ID,
    )
    await ensureMembership(db, ARENA_GSB_WS, byEmail, adminId)
    await upsertTask(
      db,
      ARENA_GSB_TASK,
      ARENA_GSB_WS,
      'Open-Ended Arena (Phase 1)',
      'arena-gsb',
    )
    await rebuildTopics(db, ARENA_GSB_TASK, ARENA_GSB_TOPICS)

    // Print URLs
    const base =
      process.env.LABELHUB_BASE_URL ?? 'http://localhost:3000'

    const pairTopics = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .where(eq(schema.topics.taskId, PAIR_RUBRIC_TASK))
    const arenaTopics = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .where(eq(schema.topics.taskId, ARENA_GSB_TASK))

    console.log('\n┌──────────────────────────────────────────────────────────────┐')
    console.log('│  Pair-Rubric demo workspace                                  │')
    console.log('├──────────────────────────────────────────────────────────────┤')
    console.log(`│  Workspace:  ${base}/workspaces/${PAIR_RUBRIC_WS}`)
    for (const t of pairTopics) {
      console.log(`│  Annotate:   ${base}/workspaces/${PAIR_RUBRIC_WS}/topics/${t.id}/annotate`)
    }
    console.log('└──────────────────────────────────────────────────────────────┘')

    console.log('\n┌──────────────────────────────────────────────────────────────┐')
    console.log('│  Arena-GSB demo workspace                                    │')
    console.log('├──────────────────────────────────────────────────────────────┤')
    console.log(`│  Workspace:  ${base}/workspaces/${ARENA_GSB_WS}`)
    for (const t of arenaTopics) {
      console.log(`│  Annotate:   ${base}/workspaces/${ARENA_GSB_WS}/topics/${t.id}/annotate`)
    }
    console.log('└──────────────────────────────────────────────────────────────┘')

    console.log(
      '\nCreds: any of the role-matrix accounts (admin/qc/annotator/viewer).',
    )
    console.log(
      `Password: Role-test-pwd-2026!  ·  emails: ${ROLE_USERS.join(', ')}\n`,
    )
  } finally {
    await close()
  }
}

main().catch((e) => {
  console.error('\n❌ seed failed:', e)
  process.exit(1)
})
