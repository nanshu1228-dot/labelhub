import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Import-wizard contract tests — Finals D21-C.
 *
 * The wizard's runtime path (parse → preview → submit) is
 * exercised by the existing D14 parser tests + the D14
 * distribution tests. This file pins the wiring contract via
 * source-byte checks so a regression that breaks the wizard's
 * integration with the D14 modules lights up CI:
 *
 *   - The page mounts the ImportWizard with createTopicsBatch.
 *   - The wizard imports detectFormat / pickParserFor / ParsedRow
 *     from the D14 parser registry.
 *   - The wizard imports distributeTopics from the D14 distribution
 *     module (not hand-rolled).
 *   - createTopicsBatch's Zod input accepts assignments (D21-C
 *     addition) and validates length parity vs items.
 */

async function readSrc(rel: string): Promise<string> {
  return readFile(resolve(process.cwd(), rel), 'utf-8')
}

describe('Import page wiring (D21-C)', () => {
  it('admin/tasks/[id]/import/page.tsx mounts ImportWizard with createTopicsBatch', async () => {
    const src = await readSrc('src/app/admin/tasks/[id]/import/page.tsx')
    expect(src).toContain(
      "import { createTopicsBatch } from '@/lib/actions/topics'",
    )
    expect(src).toContain(
      "import { ImportWizard } from '@/components/task-admin/import-wizard'",
    )
    expect(src).toContain('importBatch={createTopicsBatch}')
    // Auth guard fires + 404 to non-admins (no leak).
    expect(src).toContain('requireWorkspaceAdmin')
    expect(src).toContain('notFound()')
  })
})

describe('ImportWizard ↔ D14 module wiring', () => {
  it('imports parser registry + distribution from the D14 modules', async () => {
    const src = await readSrc(
      'src/components/task-admin/import-wizard.tsx',
    )
    expect(src).toMatch(
      /from '@\/lib\/import\/parsers'/,
    )
    expect(src).toMatch(/detectFormat/)
    expect(src).toMatch(/pickParserFor/)
    expect(src).toMatch(/distributeTopics/)
    expect(src).toMatch(/from '@\/lib\/import\/distribution'/)
  })

  it('chunks submits in groups of 100 to stay under createTopicsBatch cap', async () => {
    const src = await readSrc(
      'src/components/task-admin/import-wizard.tsx',
    )
    // createTopicsBatchSchema caps items at 100; the wizard must
    // honor that or it'll get rejected at the boundary.
    expect(src).toContain('const CHUNK_SIZE = 100')
    expect(src).toMatch(/i \+= CHUNK_SIZE/)
  })

  it('parses runaway files up to a 5_000-row hard cap so the browser does not freeze', async () => {
    const src = await readSrc(
      'src/components/task-admin/import-wizard.tsx',
    )
    expect(src).toMatch(/collected\.length >= 5_000/)
  })

  it('accepts the 4 spec-mandated extensions in the file picker', async () => {
    const src = await readSrc(
      'src/components/task-admin/import-wizard.tsx',
    )
    for (const ext of ['.jsonl', '.json', '.csv', '.xlsx']) {
      expect(src).toContain(ext)
    }
  })
})

describe('createTopicsBatch — D21-C assignments parity', () => {
  it('input schema accepts an optional assignments array', async () => {
    const src = await readSrc('src/lib/actions/topics.ts')
    expect(src).toMatch(/assignments: z[\s\S]*?\.optional\(\)/)
  })

  it('throws ValidationError when assignments.length !== items.length', async () => {
    const src = await readSrc('src/lib/actions/topics.ts')
    expect(src).toMatch(
      /assignments\.length \(\$\{[\s\S]*?\}\) must equal items\.length/,
    )
  })

  it('applies per-row assignedTo from assignments[i] when present, null otherwise', async () => {
    const src = await readSrc('src/lib/actions/topics.ts')
    expect(src).toContain('assignedTo: parsed.assignments?.[i] ?? null')
  })
})
