/**
 * Phase-18 demo: freeze v1 (and refresh v2 if rerun) on the demo
 * workspace so the DatasetVersionsCard on /settings has rows from
 * the moment a judge lands.
 *
 * Calls the same SQL the freezeDatasetVersion action runs, minus
 * the requireWorkspaceAdmin gate (we're a script with the service
 * role connection). Uses the demo workspace's admin as `frozen_by`.
 *
 * Idempotent — if v1 already exists, skip. To force a re-snapshot,
 * delete the row first.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const DEMO_WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
  })
  try {
    const [admin] = await sql<Array<{ admin_id: string }>>`
      SELECT admin_id FROM workspaces WHERE id = ${DEMO_WORKSPACE_ID}
    `
    if (!admin) {
      // eslint-disable-next-line no-console
      console.error('[seed-versions] demo workspace missing')
      process.exit(1)
    }

    const existing = await sql<Array<{ label: string }>>`
      SELECT label FROM dataset_versions WHERE workspace_id = ${DEMO_WORKSPACE_ID}
    `
    const labels = new Set(existing.map((e) => e.label))

    for (const label of ['v1', 'v2']) {
      if (labels.has(label)) {
        // eslint-disable-next-line no-console
        console.log(`[seed-versions] ${label} already exists, skipping`)
        continue
      }

      const rows = await sql<
        Array<{
          annotation_id: string
          topic_id: string
          task_id: string
          user_id: string
          payload: unknown
          claude_proposal: unknown | null
          delta_summary: string | null
          reasoning_text: string | null
          item_data: unknown
          submitted_at: Date | null
          template_mode: string
        }>
      >`
        SELECT a.id AS annotation_id, a.topic_id, tp.task_id AS task_id,
               a.user_id, a.payload, a.claude_proposal, a.delta_summary,
               a.reasoning_text, tp.item_data, a.submitted_at,
               t.template_mode
        FROM annotations a
        INNER JOIN topics tp ON tp.id = a.topic_id
        INNER JOIN tasks t ON t.id = tp.task_id
        WHERE t.workspace_id = ${DEMO_WORKSPACE_ID}
          AND tp.status = 'approved'
        ORDER BY a.submitted_at ASC NULLS LAST
      `
      if (rows.length === 0) {
        // eslint-disable-next-line no-console
        console.log('[seed-versions] no approved annotations to freeze')
        continue
      }

      const now = new Date()
      const manifest = rows.map((r) => ({
        annotationId: r.annotation_id,
        topicId: r.topic_id,
        taskId: r.task_id,
        userId: r.user_id,
        payload: r.payload,
        claudeProposal: r.claude_proposal,
        deltaSummary: r.delta_summary,
        reasoningText: r.reasoning_text,
        itemData: r.item_data,
        submittedAt: r.submitted_at?.toISOString() ?? null,
        approvedAtSnapshot: now.toISOString(),
        templateMode: r.template_mode,
      }))
      const serialized = JSON.stringify(manifest)
      const byteSize = Buffer.byteLength(serialized, 'utf8')

      await sql`
        INSERT INTO dataset_versions
          (workspace_id, label, description, item_count, manifest,
           byte_size, frozen_by)
        VALUES
          (${DEMO_WORKSPACE_ID}, ${label},
           'Initial demo snapshot — approved annotations with synthetic AI proposals for teaching-signal export',
           ${manifest.length}, ${sql.json(manifest as never)}, ${byteSize},
           ${admin.admin_id})
      `
      // eslint-disable-next-line no-console
      console.log(
        `[seed-versions] ✓ froze ${label} (${manifest.length} items, ${(byteSize / 1024).toFixed(1)} KB)`,
      )
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[seed-versions] failed:', e)
  process.exit(1)
})
