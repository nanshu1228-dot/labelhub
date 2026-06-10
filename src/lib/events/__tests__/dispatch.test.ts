import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  subscribeDomainEvent,
  dispatchDomainEvent,
  __resetDomainEventSubscribersForTest,
} from '../dispatch'

const PAYLOAD = {
  annotationId: 'a1',
  submitterUserId: 'u1',
  workspaceId: 'w1',
} as const

beforeEach(() => {
  __resetDomainEventSubscribersForTest()
  vi.restoreAllMocks()
})

describe('domain event dispatcher', () => {
  it('delivers the payload to a subscribed handler', async () => {
    const seen: unknown[] = []
    subscribeDomainEvent('annotation.approved', (p) => {
      seen.push(p)
    })
    await dispatchDomainEvent('annotation.approved', { ...PAYLOAD })
    expect(seen).toEqual([{ ...PAYLOAD }])
  })

  it('fans out to multiple subscribers', async () => {
    const calls: string[] = []
    subscribeDomainEvent('annotation.approved', () => {
      calls.push('a')
    })
    subscribeDomainEvent('annotation.approved', () => {
      calls.push('b')
    })
    await dispatchDomainEvent('annotation.approved', { ...PAYLOAD })
    expect(calls.sort()).toEqual(['a', 'b'])
  })

  it('dedupes the same handler reference (idempotent subscribe)', async () => {
    const fn = vi.fn()
    subscribeDomainEvent('annotation.approved', fn)
    subscribeDomainEvent('annotation.approved', fn)
    await dispatchDomainEvent('annotation.approved', { ...PAYLOAD })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('isolates a throwing handler — others still run, dispatch resolves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = vi.fn()
    subscribeDomainEvent('annotation.approved', () => {
      throw new Error('boom')
    })
    subscribeDomainEvent('annotation.approved', ok)
    await expect(
      dispatchDomainEvent('annotation.approved', { ...PAYLOAD }),
    ).resolves.toBeUndefined()
    expect(ok).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
  })

  it('isolates a rejecting async handler', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = vi.fn()
    subscribeDomainEvent('annotation.approved', async () => {
      throw new Error('async boom')
    })
    subscribeDomainEvent('annotation.approved', ok)
    await expect(
      dispatchDomainEvent('annotation.approved', { ...PAYLOAD }),
    ).resolves.toBeUndefined()
    expect(ok).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
  })

  it('logs loudly (console.error) when an event has no subscribers', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await dispatchDomainEvent('annotation.approved', { ...PAYLOAD })
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0]?.[0])).toContain('no subscribers')
  })
})
