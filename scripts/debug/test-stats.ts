import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    const [t] = await sql`SELECT count(*)::int AS n FROM trajectories`
    const [a] =
      await sql`SELECT count(*)::int AS n FROM annotations WHERE claude_proposal IS NOT NULL`
    const [w] = await sql`SELECT count(*)::int AS n FROM workspaces`
    const [tc] =
      await sql`SELECT count(*)::int AS n FROM trajectory_steps WHERE kind = 'tool_call'`
     
    console.log({
      trajectories: t.n,
      teaching: a.n,
      ws: w.n,
      tools: tc.n,
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((e) => {
   
  console.error(e)
  process.exit(1)
})
