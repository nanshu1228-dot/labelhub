import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  getLocalFsPublicUrl,
  getStorageDriver,
  readFromLocalFs,
  uploadToLocalFs,
} from './local-fs'

/**
 * Local FS storage driver tests — Finals self-host migration.
 *
 * Verifies the driver switch (env-controlled), path sanitization,
 * write + read round-trips, and the URL shape that nginx will serve.
 */

describe('getStorageDriver', () => {
  it("returns 'supabase' by default (no env)", () => {
    delete process.env.STORAGE_DRIVER
    expect(getStorageDriver()).toBe('supabase')
  })

  it("returns 'local' when STORAGE_DRIVER=local", () => {
    process.env.STORAGE_DRIVER = 'local'
    expect(getStorageDriver()).toBe('local')
  })

  it("case-insensitive: STORAGE_DRIVER=LOCAL works", () => {
    process.env.STORAGE_DRIVER = 'LOCAL'
    expect(getStorageDriver()).toBe('local')
  })

  it('unknown values fall back to supabase', () => {
    process.env.STORAGE_DRIVER = 'azure'
    expect(getStorageDriver()).toBe('supabase')
  })
})

describe('uploadToLocalFs + readFromLocalFs', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'lh-storage-'))
    process.env.LOCAL_STORAGE_DIR = tmp
    process.env.LOCAL_STORAGE_BASE_URL = 'https://aipert.top/storage'
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
    delete process.env.LOCAL_STORAGE_DIR
    delete process.env.LOCAL_STORAGE_BASE_URL
  })

  it('writes bytes + returns public URL shape', async () => {
    const result = await uploadToLocalFs({
      bucket: 'labelhub-media',
      key: 'ws-1/abc.png',
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      contentType: 'image/png',
    })
    expect(result.publicUrl).toBe(
      'https://aipert.top/storage/labelhub-media/ws-1/abc.png',
    )
    expect(result.path).toBe('ws-1/abc.png')

    const onDisk = await readFile(
      path.join(tmp, 'labelhub-media', 'ws-1', 'abc.png'),
    )
    expect(onDisk[0]).toBe(0x89)
    expect(onDisk[1]).toBe(0x50)
  })

  it('round-trips via readFromLocalFs', async () => {
    await uploadToLocalFs({
      bucket: 'labelhub-exports',
      key: 'ws-1/job-1.jsonl',
      bytes: Buffer.from('hello\nworld\n'),
    })
    const read = await readFromLocalFs({
      bucket: 'labelhub-exports',
      key: 'ws-1/job-1.jsonl',
    })
    expect(read).not.toBeNull()
    expect(read!.bytes.toString('utf-8')).toBe('hello\nworld\n')
  })

  it('returns null on missing key', async () => {
    const r = await readFromLocalFs({
      bucket: 'labelhub-media',
      key: 'does-not-exist.bin',
    })
    expect(r).toBeNull()
  })

  it('rejects path traversal in key', async () => {
    await expect(
      uploadToLocalFs({
        bucket: 'labelhub-media',
        key: '../../../etc/passwd',
        bytes: Buffer.from('x'),
      }),
    ).rejects.toThrow(/unsafe storage key/)
  })

  it('sanitizes bucket name (only [A-Za-z0-9_-])', async () => {
    const result = await uploadToLocalFs({
      bucket: 'evil/../bucket', // dots stripped, slashes substituted
      key: 'a.bin',
      bytes: Buffer.from('x'),
    })
    expect(result.publicUrl).not.toContain('..')
    expect(result.publicUrl).not.toContain('/evil/')
  })

  it('strips leading slashes in key', async () => {
    const result = await uploadToLocalFs({
      bucket: 'labelhub-media',
      key: '/leading-slash/file.bin',
      bytes: Buffer.from('x'),
    })
    expect(result.path).toBe('leading-slash/file.bin')
    expect(result.publicUrl).toBe(
      'https://aipert.top/storage/labelhub-media/leading-slash/file.bin',
    )
  })

  it('overwrites existing key (export retry semantics)', async () => {
    await uploadToLocalFs({
      bucket: 'labelhub-exports',
      key: 'ws-1/job-1.bin',
      bytes: Buffer.from('first'),
    })
    await uploadToLocalFs({
      bucket: 'labelhub-exports',
      key: 'ws-1/job-1.bin',
      bytes: Buffer.from('second'),
    })
    const read = await readFromLocalFs({
      bucket: 'labelhub-exports',
      key: 'ws-1/job-1.bin',
    })
    expect(read!.bytes.toString('utf-8')).toBe('second')
  })

  it('trims trailing slash on LOCAL_STORAGE_BASE_URL', async () => {
    process.env.LOCAL_STORAGE_BASE_URL = 'https://aipert.top/storage///'
    const result = await uploadToLocalFs({
      bucket: 'labelhub-media',
      key: 'a.bin',
      bytes: Buffer.from('x'),
    })
    expect(result.publicUrl).toBe(
      'https://aipert.top/storage/labelhub-media/a.bin',
    )
  })

  it('derives a local public URL for existing export job storage paths', () => {
    expect(
      getLocalFsPublicUrl({
        bucket: 'labelhub-exports',
        key: 'workspace-1/job-1.jsonl',
      }),
    ).toBe(
      'https://aipert.top/storage/labelhub-exports/workspace-1/job-1.jsonl',
    )
  })

  it('refuses public URLs for path traversal keys', () => {
    expect(
      getLocalFsPublicUrl({
        bucket: 'labelhub-exports',
        key: '../secret.env',
      }),
    ).toBeNull()
  })
})
