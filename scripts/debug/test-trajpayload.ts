import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })
import postgres from 'postgres'
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
  try {
    const rows = await sql`SELECT a.id, a.payload, a.delta_summary
      FROM annotations a INNER JOIN topics tp ON tp.id = a.topic_id
      INNER JOIN tasks t ON t.id = tp.task_id
      WHERE t.workspace_id = '00000000-0000-0000-0000-000000000010'
        AND a.submitted_at IS NOT NULL LIMIT 2`
    for (const r of rows) console.log(JSON.stringify(r, null, 2).slice(0, 600))
  } finally { await sql.end({ timeout: 5 }) }
}
main()
