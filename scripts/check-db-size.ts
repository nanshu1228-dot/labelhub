/**
 * Print a one-shot DB size summary: total bytes, per-table row counts,
 * top-10 by size. Read-only; safe to run anytime.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import postgres from 'postgres'

async function main() {
  const sql = postgres(process.env.DATABASE_URL || '', { prepare: false })

  const [{ size }] = (await sql`
    select pg_size_pretty(pg_database_size(current_database())) as size
  `) as Array<{ size: string }>
  console.log(`\nDatabase total: ${size}\n`)

  const tables = (await sql`
    select
      relname as table_name,
      pg_size_pretty(pg_total_relation_size(relid)) as total_size,
      pg_total_relation_size(relid) as size_bytes,
      n_live_tup as row_count
    from pg_stat_user_tables
    order by pg_total_relation_size(relid) desc
    limit 20
  `) as Array<{
    table_name: string
    total_size: string
    size_bytes: number
    row_count: number
  }>

  console.log('Top tables by total size:')
  console.log('━'.repeat(55))
  console.log(
    `${'table'.padEnd(28)} ${'size'.padEnd(10)} rows`,
  )
  console.log('━'.repeat(55))
  for (const t of tables) {
    console.log(
      `${t.table_name.padEnd(28)} ${t.total_size.padEnd(10)} ${t.row_count.toLocaleString()}`,
    )
  }
  console.log()

  // Aggregate counts across the core domain.
  const counts = (await sql`
    select 'trajectories' as t, count(*)::int as n from trajectories where deleted_at is null
    union all
    select 'trajectory_steps', count(*)::int from trajectory_steps
    union all
    select 'annotations', count(*)::int from annotations
    union all
    select 'step_annotations', count(*)::int from step_annotations
    union all
    select 'events', count(*)::int from events
    union all
    select 'api_request_log', count(*)::int from api_request_log
    union all
    select 'workspace_webhooks', count(*)::int from workspace_webhooks
  `) as Array<{ t: string; n: number }>

  console.log('Core domain row counts:')
  console.log('━'.repeat(55))
  for (const c of counts) {
    console.log(`${c.t.padEnd(28)} ${c.n.toLocaleString()}`)
  }

  await sql.end()
}

main().catch((e) => {
  console.error('failed:', e)
  process.exit(1)
})
