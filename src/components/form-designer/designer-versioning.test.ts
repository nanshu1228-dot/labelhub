import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Designer schema versioning UI contract', () => {
  it('routes append-only saves to the newly-created schema row', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/form-designer/designer-shell.tsx'),
      'utf8',
    )

    expect(src).toContain('const next = await storage.update')
    expect(src).toContain('router.push(`/admin/forms/${next.id}`)')
  })

  it('shows the persisted row version on the edit page', () => {
    const shellSrc = readFileSync(
      resolve(process.cwd(), 'src/components/form-designer/designer-shell.tsx'),
      'utf8',
    )
    const pageSrc = readFileSync(
      resolve(process.cwd(), 'src/app/admin/forms/[id]/page.tsx'),
      'utf8',
    )

    expect(pageSrc).toContain('version: row.version')
    expect(shellSrc).toContain('initialSchema?.version')
    expect(shellSrc).toContain('label={initialSchema?.version ? "Saved" : "Schema"}')
  })
})
