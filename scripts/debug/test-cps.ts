import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })
import postgres from 'postgres'
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
  try {
    const rows = await sql`SELECT tp.status, count(*) FILTER (WHERE a.claude_proposal IS NOT NULL)::int AS with_cp, count(*)::int AS total
      FROM annotations a INNER JOIN topics tp ON tp.id = a.topic_id
      INNER JOIN tasks t ON t.id = tp.task_id
      WHERE t.workspace_id = '00000000-0000-0000-0000-000000000010'
      GROUP BY tp.status`
    console.log(rows)
  } finally { await sql.end({ timeout: 5 }) }
}
main()
