import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })
import postgres from 'postgres'
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
  try {
    const [v] = await sql`SELECT id, label, item_count FROM dataset_versions WHERE workspace_id = '00000000-0000-0000-0000-000000000010' ORDER BY frozen_at DESC LIMIT 1`
    console.log('latest version:', v)
    if (v) {
      const [check] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM dataset_versions dv, jsonb_array_elements(dv.manifest) AS m WHERE dv.id = ${(v as { id: string }).id} AND m ? 'claudeProposal' AND m->>'claudeProposal' != 'null'`
      console.log('items with claudeProposal in manifest:', check)
    }
  } finally { await sql.end({ timeout: 5 }) }
}
main()
