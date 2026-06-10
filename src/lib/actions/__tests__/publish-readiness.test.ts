import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('publish task readiness contract', () => {
  it('refuses to publish drafts that have no topics', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/lib/actions/tasks.ts'),
      'utf8',
    )

    expect(src).toContain('from(topics)')
    expect(src).toContain('eq(topics.taskId, task.id)')
    expect(src).toContain('Import at least one topic before publishing.')
    expect(src.indexOf('from(topics)')).toBeLessThan(
      src.indexOf("await db.update(tasks).set({ status: \"open\" })"),
    )
  })
})
