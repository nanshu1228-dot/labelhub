import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function readSrc(): Promise<string> {
  return readFile(
    resolve(process.cwd(), 'src/components/workspaces/members-client.tsx'),
    'utf-8',
  )
}

describe('MembersClient destructive action UI', () => {
  it('uses inline member/invite confirmation panels instead of browser confirm()', async () => {
    const src = await readSrc()

    expect(src).not.toContain('confirm(')
    expect(src).toContain('confirmingRemove')
    expect(src).toContain('REMOVE MEMBER')
    expect(src).toContain('Remove member')
    expect(src).toContain('confirmingRevoke')
    expect(src).toContain('REVOKE INVITE')
    expect(src).toContain('Revoke invite')
  })
})
