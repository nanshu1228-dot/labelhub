import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function readSrc(rel: string): Promise<string> {
  return readFile(resolve(process.cwd(), rel), 'utf-8')
}

describe('Owner task lifecycle UI', () => {
  it('uses inline confirmation panels instead of browser confirm dialogs', async () => {
    const lifecycle = await readSrc(
      'src/components/task-admin/publish-task-button.tsx',
    )
    const archive = await readSrc(
      'src/components/task-admin/archive-task-button.tsx',
    )
    const taskDetail = await readSrc(
      'src/app/workspaces/[id]/tasks/[taskId]/page.tsx',
    )
    const taskList = await readSrc('src/app/workspaces/[id]/tasks/page.tsx')

    expect(lifecycle).not.toContain('window.confirm')
    expect(lifecycle).not.toContain('confirm(')
    expect(lifecycle).toContain('confirmRequest')
    expect(lifecycle).toContain('Cancel')
    expect(lifecycle).toContain('publishDisabledReason')
    expect(taskDetail).toContain('Import at least one topic before publishing.')
    expect(taskList).toContain('Import at least one topic before publishing.')

    expect(archive).not.toContain('window.confirm')
    expect(archive).not.toContain('confirm(')
    expect(archive).toContain('confirming')
    expect(archive).toContain('Archive this task?')
  })
})
