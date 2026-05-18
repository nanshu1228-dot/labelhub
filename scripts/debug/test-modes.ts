import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })
import postgres from 'postgres'
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
  try {
    const rows = await sql`SELECT t.template_mode, count(*)::int AS n
      FROM annotations a INNER JOIN topics tp ON tp.id = a.topic_id
      INNER JOIN tasks t ON t.id = tp.task_id
      WHERE t.workspace_id = '00000000-0000-0000-0000-000000000010'
        AND a.submitted_at IS NOT NULL
      GROUP BY t.template_mode`
    console.log(rows)
  } finally { await sql.end({ timeout: 5 }) }
}
main()
