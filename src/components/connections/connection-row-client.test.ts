import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function readSrc(): Promise<string> {
  return readFile(
    resolve(process.cwd(), 'src/components/connections/connection-row-client.tsx'),
    'utf-8',
  )
}

describe('ConnectionRowClient destructive action UI', () => {
  it('uses an inline delete confirmation instead of browser confirm()', async () => {
    const src = await readSrc()

    expect(src).not.toContain('confirm(')
    expect(src).toContain('confirmingDelete')
    expect(src).toContain('DELETE CONNECTION')
    expect(src).toContain('delete connection')
  })
})
