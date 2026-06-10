import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function readSrc(rel: string): Promise<string> {
  return readFile(resolve(process.cwd(), rel), 'utf-8')
}

describe('AppHeader labeler entry', () => {
  it('uses the task-card workbench as the primary annotator entry', async () => {
    const src = await readSrc('src/components/app-shell/app-header.tsx')

    expect(src).toContain('<HeaderPill href="/my/tasks" label="Tasks" />')
    expect(src).toContain('<DrawerLink href="/my/tasks" label="Tasks" />')
    expect(src).toContain('<DrawerLink href="/my/tasks" label="My tasks" />')
    expect(src).toContain('<DrawerLink href="/my/queue" label="Flat queue" />')
    expect(src).not.toContain('<HeaderPill href="/my/queue" label="Queue" />')
  })

  it('routes marketing Workbench links to the same task workbench', async () => {
    const src = await readSrc('src/components/site/nav.tsx')

    expect(src).toContain('<Link href="/my/tasks" className="nav-link">')
    expect(src).not.toContain('<Link href="/my/queue" className="nav-link">')
  })
})
