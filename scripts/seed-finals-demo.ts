/**
 * Finals demo seed — Finals D19-D.
 *
 * Bootstraps a workspace + two custom-designer tasks pre-loaded with
 * the official qa_quality + preference_compare datasets so a fresh
 * judge can land on /my/queue and start labeling within 60 seconds.
 *
 *   npm run seed:finals-demo
 *
 * Re-runnable: every row uses a deterministic UUID (SHA-1 derived
 * from a stable name) + onConflictDoNothing, so this script is
 * idempotent — running it twice is a no-op on existing rows.
 *
 * Inputs:
 *   - tmp-data/datasets/qa_quality/jsonl/qa_quality.jsonl
 *   - tmp-data/datasets/preference_compare/jsonl/preference_compare.jsonl
 *   - The two FormSchema templates from src/lib/form-designer/templates/
 *
 * Outputs (idempotent):
 *   - 1 demo admin user (id pinned by SEED_FINALS_ADMIN_ID env or
 *     the local default below)
 *   - 1 workspace 'Finals Demo · Annotation 평가'
 *   - 2 custom_form_schemas rows (one per template)
 *   - 2 tasks (one per dataset), each referencing the matching
 *     schema via templateConfig.formSchemaId + an aiAgent config
 *     pre-populated with the template's recommended dimensions
 *   - 30 + 12 = 42 topics across the two tasks (verbatim itemData
 *     from the official JSONL — uses the D14 parser so this also
 *     doubles as an integration smoke for the parser against real
 *     production-shape data)
 *
 * The script intentionally does NOT create the seeded admin in
 * Supabase Auth. To "log in" as them, sign up via the UI then
 * re-run with `SEED_FINALS_ADMIN_ID=<your-real-uuid>` so the
 * workspace pivots to your auth identity.
 */

import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema'
import { OFFICIAL_TEMPLATES } from '../src/lib/form-designer/templates'
import { parseJSONL } from '../src/lib/import/parsers/jsonl'

const SEED_NS = 'labelhub.seed.finals'

/**
 * Deterministic UUID derived from a stable name. Equivalent shape
 * to UUIDv5 (SHA-1 namespace + name, with version/variant bits set
 * per RFC 4122). Two seed runs that use the same NAME will produce
 * the same UUID — that's what makes onConflictDoNothing a clean
 * no-op on re-run.
 */
function derivedUuid(name: string): string {
  const h = createHash('sha1')
    .update(`${SEED_NS}:${name}`)
    .digest()
  // Version 5 (name-based, SHA-1)
  h[6] = (h[6] & 0x0f) | 0x50
  // Variant RFC 4122
  h[8] = (h[8] & 0x3f) | 0x80
  const hex = h.toString('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const DEMO_ADMIN_ID =
  process.env.SEED_FINALS_ADMIN_ID ?? derivedUuid('admin')
const DEMO_WORKSPACE_ID = derivedUuid('workspace')
const SCHEMA_QA_QUALITY_ID = derivedUuid('schema:qa-quality')
const SCHEMA_PREFERENCE_ID = derivedUuid('schema:preference-compare')
const TASK_QA_QUALITY_ID = derivedUuid('task:qa-quality')
const TASK_PREFERENCE_ID = derivedUuid('task:preference-compare')

const DATASET_BASE = resolve(
  __dirname,
  '..',
  'tmp-data',
  'datasets',
)

async function readDataset(
  relPath: string,
): Promise<Array<Record<string, unknown>>> {
  const fullPath = resolve(DATASET_BASE, relPath)
  const buf = await readFile(fullPath)
  const out: Record<string, unknown>[] = []
  for await (const row of parseJSONL(new Uint8Array(buf))) {
    if (row.row && typeof row.row === 'object') {
      out.push(row.row as Record<string, unknown>)
    }
  }
  return out
}

interface SeedTask {
  templateId: 'qa-quality' | 'preference-compare'
  taskId: string
  schemaId: string
  name: string
  description: string
  datasetPath: string
  guidelinesPath: string
}

const SEED_TASKS: SeedTask[] = [
  {
    templateId: 'qa-quality',
    taskId: TASK_QA_QUALITY_ID,
    schemaId: SCHEMA_QA_QUALITY_ID,
    name: '问答质量标注 · Finals Demo',
    description:
      '对模型回答按相关性 / 准确性 / 格式合规 / 安全性四个维度打分。30 个题目，含图片 / 视频 / Markdown 多媒体题。',
    datasetPath: 'qa_quality/jsonl/qa_quality.jsonl',
    guidelinesPath: 'qa_quality/标注要求.md',
  },
  {
    templateId: 'preference-compare',
    taskId: TASK_PREFERENCE_ID,
    schemaId: SCHEMA_PREFERENCE_ID,
    name: '偏好对比标注 · Finals Demo',
    description:
      '两路模型回答 A/B 二选一 + 平局，附判断维度与详细理由。12 个题目。',
    datasetPath: 'preference_compare/jsonl/preference_compare.jsonl',
    guidelinesPath: 'preference_compare/标注要求.md',
  },
]

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('❌ DATABASE_URL not set. Add it to .env.local first.')
    process.exit(1)
  }
  const sql = postgres(url, { prepare: false })
  const db = drizzle(sql, { schema })

  console.log('🌱 Seeding LabelHub finals demo data…')
  console.log(`   admin id:      ${DEMO_ADMIN_ID}`)
  console.log(`   workspace id:  ${DEMO_WORKSPACE_ID}`)

  // 1. Admin user
  await db
    .insert(schema.users)
    .values({
      id: DEMO_ADMIN_ID,
      email: 'finals-demo-admin@labelhub.local',
      displayName: 'Finals Demo Admin',
    })
    .onConflictDoNothing()
  console.log('  ✓ users')

  // 2. Workspace (custom-designer is the default mode hint, though
  //    each task carries its own templateMode).
  await db
    .insert(schema.workspaces)
    .values({
      id: DEMO_WORKSPACE_ID,
      name: 'Finals Demo · Annotation Workbench',
      templateMode: 'custom-designer',
      adminId: DEMO_ADMIN_ID,
      settings: { seed: 'finals-demo' },
    })
    .onConflictDoNothing()
  console.log('  ✓ workspaces')

  // Workspace membership row — without this, the admin can't see
  // the workspace in /my/tasks or /my/queue.
  await db
    .insert(schema.workspaceMembers)
    .values({
      workspaceId: DEMO_WORKSPACE_ID,
      userId: DEMO_ADMIN_ID,
      role: 'admin',
    })
    .onConflictDoNothing()
  console.log('  ✓ workspace_members')

  // 3. Custom form schemas (one per official template). Deterministic
  //    UUIDs so re-running this script is a no-op.
  for (const seed of SEED_TASKS) {
    const template = OFFICIAL_TEMPLATES.find((t) => t.id === seed.templateId)
    if (!template) {
      console.error(`  ❌ template ${seed.templateId} missing from gallery`)
      continue
    }
    await db
      .insert(schema.customFormSchemas)
      .values({
        id: seed.schemaId,
        workspaceId: DEMO_WORKSPACE_ID,
        label: template.label,
        schema: template.schema,
        version: template.schema.version,
        createdBy: DEMO_ADMIN_ID,
      })
      .onConflictDoNothing()
  }
  console.log(`  ✓ custom_form_schemas (${SEED_TASKS.length})`)

  // 4. Tasks — one per dataset, each referencing the matching schema
  //    + an aiAgent config seeded with the template's recommended
  //    dimensions so the AI Review Agent works out of the box.
  for (const seed of SEED_TASKS) {
    const template = OFFICIAL_TEMPLATES.find((t) => t.id === seed.templateId)!
    let guidelines = ''
    try {
      guidelines = await readFile(
        resolve(DATASET_BASE, seed.guidelinesPath),
        'utf-8',
      )
    } catch {
      // Non-fatal: missing 标注要求.md just leaves guidelines empty.
    }
    await db
      .insert(schema.tasks)
      .values({
        id: seed.taskId,
        workspaceId: DEMO_WORKSPACE_ID,
        name: seed.name,
        phase: 1,
        description: seed.description,
        guidelinesMarkdown: guidelines || null,
        templateMode: 'custom-designer',
        templateConfig: {
          formSchemaId: seed.schemaId,
          aiAgent: {
            enabled: true,
            promptTemplate:
              `请按以下维度对此次标注的核心字段（模型回答 / response_a / response_b 等）进行评估，给出 pass / send_back / human_review 结论与每个维度的 0-100 分。\n\n维度：${template.aiDimensions.map((d) => d.name).join(' / ')}`,
            dimensions: template.aiDimensions,
            passAt: 70,
            sendBackAt: 40,
            tier: 'fast',
          },
        },
        rewardConfig: {
          type: 'cash-per-item',
          currency: 'CNY',
          amount: 5,
          qualityMultiplierMin: 1.0,
          qualityMultiplierMax: 1.5,
        },
        status: 'open',
      })
      .onConflictDoNothing()
  }
  console.log(`  ✓ tasks (${SEED_TASKS.length})`)

  // 5. Topics — ingest each row of each dataset through the D14
  //    JSONL parser. Topic IDs derive from `${taskId}:${row.id}` so
  //    re-running this script is idempotent.
  let totalTopics = 0
  for (const seed of SEED_TASKS) {
    const rows = await readDataset(seed.datasetPath)
    for (const row of rows) {
      const externalId = String(
        (row as { id?: unknown }).id ?? '',
      ).trim()
      if (!externalId) continue
      const topicId = derivedUuid(`topic:${seed.taskId}:${externalId}`)
      await db
        .insert(schema.topics)
        .values({
          id: topicId,
          taskId: seed.taskId,
          itemData: row,
          status: 'drafting',
        })
        .onConflictDoNothing()
      totalTopics++
    }
    console.log(
      `  ✓ topics for ${seed.templateId} (${rows.length} rows from dataset)`,
    )
  }
  console.log(`  ✓ topics total: ${totalTopics}`)

  // 6. Audit event — ties everything together in the workspace's
  //    recent-events feed so an admin opening the dashboard sees
  //    "finals demo seeded" right away.
  await db.insert(schema.events).values({
    type: 'task.published',
    workspaceId: DEMO_WORKSPACE_ID,
    actorId: DEMO_ADMIN_ID,
    payload: {
      source: 'seed-finals-demo',
      tasksCreated: SEED_TASKS.length,
      topicsCreated: totalTopics,
      templates: OFFICIAL_TEMPLATES.map((t) => t.id),
    },
  })

  console.log('')
  console.log('✅ Finals demo seeded.')
  console.log('   Sign in at /signin as finals-demo-admin@labelhub.local')
  console.log('   then visit /my/queue to see the imported topics.')

  await sql.end({ timeout: 5 })
}

main().catch((e) => {
  console.error('❌ Seed failed:', e instanceof Error ? e.stack ?? e.message : e)
  process.exit(1)
})
