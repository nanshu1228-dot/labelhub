/**
 * One-shot backfill: compute `trajectories.features` for every existing
 * row that has an empty/missing features object. Safe to re-run — only
 * touches rows whose `features` is empty or has no `v` field.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema'
import { extractFeatures } from '../src/lib/trajectories/extract-features'

async function main() {
  const sql = postgres(process.env.DATABASE_URL || '', { prepare: false })
  const db = drizzle(sql, { schema })

  const rows = await db.select().from(schema.trajectories)
  console.log(`scanning ${rows.length} trajectories...`)

  let updated = 0
  let skipped = 0
  for (const t of rows) {
    const f = (t.features ?? {}) as Record<string, unknown>
    if (typeof f.v === 'number') {
      skipped++
      continue
    }
    const steps = await db
      .select()
      .from(schema.trajectorySteps)
      .where(eq(schema.trajectorySteps.trajectoryId, t.id))
    const features = extractFeatures(steps)
    await db
      .update(schema.trajectories)
      .set({ features })
      .where(eq(schema.trajectories.id, t.id))
    updated++
    if (updated % 10 === 0) process.stdout.write(`  ${updated}…\r`)
  }
  console.log(`\n  ✓ updated ${updated} · skipped ${skipped}`)

  // Quick sanity counts
  const [bucketRow] = (await sql`
    select
      sum(case when features->>'outcome' = 'completed' then 1 else 0 end)::int as completed,
      sum(case when features->>'outcome' = 'errored'   then 1 else 0 end)::int as errored,
      sum(case when features->>'outcome' = 'incomplete' then 1 else 0 end)::int as incomplete,
      sum(case when features->>'loopDetected' = 'true' then 1 else 0 end)::int as loops,
      sum((features->>'stepCount')::int) as total_steps,
      avg((features->>'stepCount')::int)::int as avg_steps
    from trajectories
    where (features->>'v')::int = 1
  `) as Array<{
    completed: number
    errored: number
    incomplete: number
    loops: number
    total_steps: number
    avg_steps: number
  }>
  console.log('\noutcome distribution:')
  console.log(`  completed:  ${bucketRow.completed}`)
  console.log(`  errored:    ${bucketRow.errored}`)
  console.log(`  incomplete: ${bucketRow.incomplete}`)
  console.log(`  loops:      ${bucketRow.loops}`)
  console.log(`  total_steps: ${bucketRow.total_steps}  avg: ${bucketRow.avg_steps}`)

  await sql.end()
}

main().catch((e) => {
  console.error('backfill failed:', e)
  process.exit(1)
})
