import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

describe('task export route contract', () => {
  it('keeps default table exports aligned with AI review timing fields', async () => {
    const src = await readFile(
      resolve(
        process.cwd(),
        'src/app/api/workspaces/[id]/tasks/[taskId]/export/route.ts',
      ),
      'utf-8',
    )

    expect(src).toContain("source: 'ai_review_started_at'")
    expect(src).toContain("source: 'ai_review_finished_at'")
    expect(src).toContain("source: 'review_events'")
  })
})
