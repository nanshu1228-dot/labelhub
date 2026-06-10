import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function readSrc(): Promise<string> {
  return readFile(
    resolve(process.cwd(), 'src/components/quality/gold-promote-client.tsx'),
    'utf-8',
  )
}

describe('GoldPromoteClient destructive action UI', () => {
  it('uses an inline unmark confirmation instead of browser confirm()', async () => {
    const src = await readSrc()

    expect(src).not.toContain('confirm(')
    expect(src).toContain('confirmingUnmark')
    expect(src).toContain('REMOVE GOLD STANDARD')
    expect(src).toContain('Remove gold')
  })
})
