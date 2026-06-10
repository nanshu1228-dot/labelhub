/**
 * Seed an ISOLATED smoke workspace for `doctor --deep` — mirrors the known-good
 * seed-finals-demo.ts insert shapes, but in a separate workspace owned by the
 * smoke admin, so the deep lifecycle run never touches the demo data.
 *
 *   SMOKE_ADMIN_ID=<supabase auth uuid> DATABASE_URL=<...> \
 *     npx tsx scripts/seed-smoke-workspace.ts
 *
 * Idempotent: deterministic UUIDs + onConflictDoNothing. Prints the workspace id.
 * Creates: smoke admin users row + workspace ("SMOKE · doctor") + admin
 * membership + one qa-quality custom_form_schema + one task (with aiAgent) +
 * the first N topics from the real qa_quality dataset (verbatim itemData shape).
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

const SEED_NS = 'labelhub.seed.smoke'
function derivedUuid(name: string): string {
  const h = createHash('sha1').update(`${SEED_NS}:${name}`).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const hex = h.toString('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const TOPIC_COUNT = 6

async function main() {
  const url = process.env.DATABASE_URL
  const adminId = process.env.SMOKE_ADMIN_ID
  if (!url) throw new Error('DATABASE_URL not set')
  if (!adminId) throw new Error('SMOKE_ADMIN_ID not set (the supabase auth uuid)')

  const WS = derivedUuid('workspace')
  const SCHEMA_ID = derivedUuid('schema:qa-quality')
  const TASK_ID = derivedUuid('task:qa-quality')

  const template = OFFICIAL_TEMPLATES.find((t) => t.id === 'qa-quality')
  if (!template) throw new Error('qa-quality template missing from gallery')

  const sql = postgres(url, { max: 1, prepare: false })
  const db = drizzle(sql, { schema })

  try {
    console.log('🌱 seeding SMOKE workspace…')
    console.log(`   admin id:     ${adminId}`)
    console.log(`   workspace id: ${WS}`)

    // 1. smoke admin user row (mirrors what requireUser would upsert on login)
    await db
      .insert(schema.users)
      .values({ id: adminId, email: 'doctor-smoke@labelhub.local', displayName: 'Doctor Smoke Admin' })
      .onConflictDoNothing()

    // 2. isolated workspace + admin membership
    await db
      .insert(schema.workspaces)
      .values({
        id: WS,
        name: 'SMOKE · doctor',
        templateMode: 'custom-designer',
        adminId,
        settings: { seed: 'doctor-smoke' },
      })
      .onConflictDoNothing()
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: WS, userId: adminId, role: 'admin' })
      .onConflictDoNothing()

    // 3. qa-quality form schema
    await db
      .insert(schema.customFormSchemas)
      .values({
        id: SCHEMA_ID,
        workspaceId: WS,
        label: template.label,
        schema: template.schema,
        version: template.schema.version,
        createdBy: adminId,
      })
      .onConflictDoNothing()

    // 4. one task with aiAgent config (same shape as finals seed)
    await db
      .insert(schema.tasks)
      .values({
        id: TASK_ID,
        workspaceId: WS,
        name: 'SMOKE 问答质量标注 · doctor',
        phase: 1,
        description: 'doctor 深度体检专用任务,数据与 demo 隔离。',
        templateMode: 'custom-designer',
        templateConfig: {
          formSchemaId: SCHEMA_ID,
          aiAgent: {
            enabled: true,
            promptTemplate: `请按维度评估模型回答,给出 pass / send_back / human_review 与每维 0-100 分。\n维度:${template.aiDimensions.map((d) => d.name).join(' / ')}`,
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

    // 5. first N topics from the real qa_quality dataset (verbatim shape)
    const datasetPath = resolve(
      __dirname,
      '..',
      'tmp-data',
      'datasets',
      'qa_quality',
      'jsonl',
      'qa_quality.jsonl',
    )
    const buf = await readFile(datasetPath)
    const rows: Record<string, unknown>[] = []
    for await (const r of parseJSONL(new Uint8Array(buf))) {
      if (r.row && typeof r.row === 'object') rows.push(r.row as Record<string, unknown>)
      if (rows.length >= TOPIC_COUNT) break
    }
    let n = 0
    for (const row of rows) {
      const externalId = String((row as { id?: unknown }).id ?? '').trim()
      if (!externalId) continue
      await db
        .insert(schema.topics)
        .values({
          id: derivedUuid(`topic:${TASK_ID}:${externalId}`),
          taskId: TASK_ID,
          itemData: row,
          status: 'drafting',
        })
        .onConflictDoNothing()
      n++
    }

    await db.insert(schema.events).values({
      type: 'task.published',
      workspaceId: WS,
      actorId: adminId,
      payload: { source: 'seed-smoke-workspace', topics: n },
    })

    console.log(`  ✓ smoke workspace ready (${n} topics)`)
    console.log(`SMOKE_WORKSPACE_ID=${WS}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
  console.error('❌ smoke seed failed:', e instanceof Error ? (e.stack ?? e.message) : e)
  process.exit(1)
})
