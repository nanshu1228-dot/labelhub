import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Per-annotator claim quota (spec §4.1 配额抢单 / "Quota pool" distribution).
 * Verifies assertWithinClaimQuota only caps the quota-by-annotator strategy,
 * counts the user's held topics, and throws ConflictError at/over the cap.
 */

vi.mock('@/lib/db/client', () => ({ getDb: vi.fn() }))

import { assertWithinClaimQuota } from '../quota'
import { getDb } from '@/lib/db/client'
import { ConflictError } from '@/lib/errors'

/** Mock getDb so the count query resolves to `held` rows for the user. */
function mockHeld(held: number) {
  const where = vi.fn(() => Promise.resolve([{ held }]))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  vi.mocked(getDb).mockReturnValue({ select } as never)
  return { select, from, where }
}

const quotaConfig = (quotaTotal: number | null) => ({
  taskSettings: { distributionStrategy: 'quota-by-annotator', quotaTotal },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertWithinClaimQuota', () => {
  it('is a no-op for non-quota strategies (never queries the DB)', async () => {
    const m = mockHeld(999)
    await expect(
      assertWithinClaimQuota('task-1', { taskSettings: { distributionStrategy: 'open-queue', quotaTotal: 1 } }, 'u1'),
    ).resolves.toBeUndefined()
    expect(m.select).not.toHaveBeenCalled()
  })

  it('is a no-op when quota strategy has no quotaTotal configured', async () => {
    const m = mockHeld(999)
    await expect(
      assertWithinClaimQuota('task-1', quotaConfig(null), 'u1'),
    ).resolves.toBeUndefined()
    expect(m.select).not.toHaveBeenCalled()
  })

  it('allows a claim while under the quota', async () => {
    mockHeld(2)
    await expect(
      assertWithinClaimQuota('task-1', quotaConfig(3), 'u1'),
    ).resolves.toBeUndefined()
  })

  it('rejects a claim at the quota with ConflictError', async () => {
    mockHeld(3)
    await expect(
      assertWithinClaimQuota('task-1', quotaConfig(3), 'u1'),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('rejects a claim over the quota', async () => {
    mockHeld(5)
    await expect(
      assertWithinClaimQuota('task-1', quotaConfig(3), 'u1'),
    ).rejects.toThrow(/quota of 3/)
  })

  it('handles a malformed templateConfig as no-quota (no-op)', async () => {
    const m = mockHeld(999)
    await expect(assertWithinClaimQuota('task-1', null, 'u1')).resolves.toBeUndefined()
    expect(m.select).not.toHaveBeenCalled()
  })
})
