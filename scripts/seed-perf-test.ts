/**
 * Stress-test seed — one trajectory with N steps (default 1000) in the
 * demo workspace, so we can validate the AGENTS.md hard perf rule:
 *
 *   "Annotation grids: @tanstack/react-virtual mandatory past 30 rows.
 *    Row state: Jotai atomFamily keyed by row ID."
 *
 * Run:  npm run seed:perf-test          # 1000 steps
 *       PERF_STEPS=5000 npm run seed:perf-test
 *
 * Then open
 *   /workspaces/00000000-0000-0000-0000-000000000010/trajectories/
 *   00000000-0000-0000-0000-0000000099ff/annotate
 *
 * What to check by eye:
 *   - Step list virtualizer keeps ~12 DOM nodes regardless of N
 *   - HeatMapStrip caps at ~200 segments even when N=5000
 *   - Pressing 1/3/5 on a step responds instantly
 *   - Scrolling the step list is smooth (no jank past 60fps target)
 *
 * Idempotent — re-run drops the prior steps + re-creates them with the
 * current PERF_STEPS value. The trajectory id is hardcoded so the URL
 * is stable; only its step set churns.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema'

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'
const TRAJECTORY_ID = '00000000-0000-0000-0000-0000000099ff'
const STEPS = Number(process.env.PERF_STEPS ?? 1000)
if (!Number.isInteger(STEPS) || STEPS < 30 || STEPS > 10000) {
  console.error(
    `PERF_STEPS=${process.env.PERF_STEPS} invalid — must be an integer in [30, 10000].`,
  )
  process.exit(1)
}

type StepKind = 'thinking' | 'tool_call' | 'tool_result' | 'final_response'

function pickKind(seq: number): StepKind {
  // Repeating pattern that mimics a real agentic loop:
  //   think → call → result → think → call → result → ... → final
  if (seq === STEPS - 1) return 'final_response'
  const mod = seq % 3
  if (mod === 0) return 'thinking'
  if (mod === 1) return 'tool_call'
  return 'tool_result'
}

function makeContent(
  kind: StepKind,
  seq: number,
): Record<string, unknown> {
  switch (kind) {
    case 'thinking':
      return {
        text: `Step ${seq}: planning the next action. The user wants the Q3 report summary so I should pull the relevant rows first.`,
      }
    case 'tool_call':
      return {
        toolCallId: `tc_${seq}`,
        toolName: seq % 6 === 1 ? 'read_file' : 'web_search',
        args: { query: `bullet ${seq}`, max_results: 5 },
        providerKind: 'function',
      }
    case 'tool_result':
      return {
        toolCallId: `tc_${seq - 1}`,
        output: `{"items":[{"title":"Item ${seq}","summary":"A short summary."}]}`,
      }
    case 'final_response':
      return {
        text: `Final answer summarizing all ${STEPS} steps. The biggest finding is X; the second is Y; the third is Z.`,
      }
  }
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL || '', { prepare: false })
  const db = drizzle(sql, { schema })

  console.log(`seeding perf-test trajectory (${STEPS} steps)...`)

  // 1. Ensure an inbox task exists.
  const [inboxTask] = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.workspaceId, WORKSPACE_ID),
        eq(schema.tasks.name, 'Inbox — Captured Trajectories'),
      ),
    )
    .limit(1)
  if (!inboxTask) {
    console.error(
      'Inbox task missing — run `npm run seed:rich-demo` first to bootstrap the demo workspace.',
    )
    process.exit(1)
  }

  // 2. Upsert the trajectory row.
  const [existing] = await db
    .select({ id: schema.trajectories.id })
    .from(schema.trajectories)
    .where(eq(schema.trajectories.id, TRAJECTORY_ID))
    .limit(1)
  if (!existing) {
    await db.insert(schema.trajectories).values({
      id: TRAJECTORY_ID,
      workspaceId: WORKSPACE_ID,
      taskId: inboxTask.id,
      source: 'synthetic',
      agentName: 'perf-test/long-trace',
      rootPrompt: `Stress-test trajectory with ${STEPS} synthetic steps. Used to validate that the annotation grid stays smooth at scale (see AGENTS.md perf rules).`,
      finalResponse: `Done after ${STEPS} steps.`,
      meta: { seedPerfTest: true, stepCount: STEPS },
      schemaVersion: '1.0',
    })
    console.log('  ✓ trajectory created')
  } else {
    // Update meta so it's accurate.
    await db
      .update(schema.trajectories)
      .set({
        rootPrompt: `Stress-test trajectory with ${STEPS} synthetic steps.`,
        meta: { seedPerfTest: true, stepCount: STEPS },
      })
      .where(eq(schema.trajectories.id, TRAJECTORY_ID))
    console.log('  ✓ trajectory updated')
  }

  // 3. Drop existing steps + recreate with the requested count.
  await db
    .delete(schema.trajectorySteps)
    .where(eq(schema.trajectorySteps.trajectoryId, TRAJECTORY_ID))

  // Insert in chunks of 500 so we don't blow postgres-js' parameter limit.
  const CHUNK = 500
  for (let i = 0; i < STEPS; i += CHUNK) {
    const batch = []
    for (let j = 0; j < CHUNK && i + j < STEPS; j++) {
      const seq = i + j
      const kind = pickKind(seq)
      batch.push({
        trajectoryId: TRAJECTORY_ID,
        sequence: seq,
        kind,
        content: makeContent(kind, seq),
        modelName: 'demo-synthetic',
      })
    }
    if (batch.length === 0) break
    await db.insert(schema.trajectorySteps).values(batch)
    process.stdout.write(`  ${Math.min(i + CHUNK, STEPS)}/${STEPS}\r`)
  }
  console.log(`  ✓ ${STEPS} steps inserted    `)

  console.log(
    `\ndone. open:\n  /workspaces/${WORKSPACE_ID}/trajectories/${TRAJECTORY_ID}/annotate\n`,
  )

  await sql.end()
}

main().catch((e) => {
  console.error('failed:', e)
  process.exit(1)
})
