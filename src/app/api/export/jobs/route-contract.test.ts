import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

describe('export job polling route contract', () => {
  it('returns local-storage public URLs on the self-host storage driver', async () => {
    const src = await readFile(
      resolve(process.cwd(), 'src/app/api/export/jobs/[id]/route.ts'),
      'utf-8',
    )

    expect(src).toContain("getStorageDriver() === 'local'")
    expect(src).toContain('getLocalFsPublicUrl')
    expect(src).toContain('EXPORT_STORAGE_BUCKET')
    expect(src).toContain('createSignedUrl(job.storagePath, 60)')
  })
})
