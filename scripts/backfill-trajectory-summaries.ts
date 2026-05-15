/**
 * Backfill `trajectories.summary` via the fast-tier LLM. Idempotent —
 * skips rows that already have a non-null summary (set FORCE=1 to override).
 *
 * Bypasses the server-action layer (which pulls `server-only`, blocked from
 * the tsx CLI) and goes straight to the summarizer + DB.
 *
 * Throttled 250ms between calls to be polite. ~¥0.003 per call.
 */
// `server-only` is patched out by --import ./scripts/_server-only-stub.mjs
// (see package.json). Without the loader, importing the summarizer chain
// throws at the top-level `import 'server-only'`.

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema'
import { summarizeTrajectory } from '../src/lib/ai/trajectory-summarizer'

const FORCE = process.env.FORCE === '1'
const THROTTLE_MS = 250

async function main() {
  const sql = postgres(process.env.DATABASE_URL || '', { prepare: false })
  const db = drizzle(sql, { schema })

  const rows = await db
    .select({
      id: schema.trajectories.id,
      agentName: schema.trajectories.agentName,
      rootPrompt: schema.trajectories.rootPrompt,
      finalResponse: schema.trajectories.finalResponse,
      summary: schema.trajectories.summary,
    })
    .from(schema.trajectories)
  console.log(`scanning ${rows.length} trajectories (FORCE=${FORCE})...`)

  let done = 0
  let skipped = 0
  let failed = 0
  for (const t of rows) {
    if (!FORCE && t.summary) {
      skipped++
      continue
    }
    const steps = await db
      .select()
      .from(schema.trajectorySteps)
      .where(eq(schema.trajectorySteps.trajectoryId, t.id))
      .orderBy(schema.trajectorySteps.sequence)
    if (steps.length === 0) {
      failed++
      console.log(`  ${t.id.slice(0, 8)}… SKIP: no steps`)
      continue
    }
    try {
      const result = await summarizeTrajectory({
        agentName: t.agentName,
        rootPrompt: t.rootPrompt,
        finalResponse: t.finalResponse,
        steps: steps.map((s) => ({
          sequence: s.sequence,
          kind: s.kind,
          content: s.content,
        })),
      })
      const stored = JSON.stringify({
        v: 1,
        summary: result.summary.summary,
        pattern: result.summary.pattern,
        keywords: result.summary.keywords,
      })
      await db
        .update(schema.trajectories)
        .set({
          summary: stored,
          summaryAt: new Date(),
          summaryModel: result.usage.model,
        })
        .where(eq(schema.trajectories.id, t.id))
      done++
      console.log(
        `  [${done + skipped + failed}/${rows.length}] ${t.id.slice(0, 8)}… ${result.summary.pattern}`,
      )
    } catch (e) {
      failed++
      console.log(
        `  [${done + skipped + failed}/${rows.length}] ${t.id.slice(0, 8)}… FAIL: ${e instanceof Error ? e.message : e}`,
      )
    }
    if (THROTTLE_MS > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS))
  }

  console.log(`\n  ✓ summarized ${done} · skipped ${skipped} · failed ${failed}`)
  await sql.end()
}

main().catch((e) => {
  console.error('backfill failed:', e)
  process.exit(1)
})
