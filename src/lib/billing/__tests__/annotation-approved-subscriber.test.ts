import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The gateway side of the inverted core→billing seam. Verifies that
 * registerBillingSubscribers() wires an `annotation.approved` handler that maps
 * the domain payload to the two idempotent billing reactions (invite-reward
 * scan + payout accrual), is idempotent, and is best-effort (a failing reaction
 * never rejects the dispatch).
 */

vi.mock('@/lib/billing/invite-rewards', () => ({
  scanInviteRewardOnApproval: vi.fn(async () => undefined),
}))
vi.mock('@/lib/actions/billing/approve-annotation', () => ({
  approveAnnotation: vi.fn(async () => ({ ok: true })),
}))

import { registerBillingSubscribers } from '../subscribers/annotation-approved'
import {
  dispatchDomainEvent,
  __resetDomainEventSubscribersForTest,
} from '@/lib/events/dispatch'
import { scanInviteRewardOnApproval } from '@/lib/billing/invite-rewards'
import { approveAnnotation } from '@/lib/actions/billing/approve-annotation'

beforeEach(() => {
  __resetDomainEventSubscribersForTest()
  vi.clearAllMocks()
})

describe('billing annotation.approved subscriber', () => {
  it('maps the payload to the invite-reward scan + payout accrual', async () => {
    registerBillingSubscribers()
    await dispatchDomainEvent('annotation.approved', {
      annotationId: 'anno-1',
      submitterUserId: 'sub-1',
      workspaceId: 'ws-1',
    })
    expect(scanInviteRewardOnApproval).toHaveBeenCalledTimes(1)
    expect(scanInviteRewardOnApproval).toHaveBeenCalledWith({
      inviteeUserId: 'sub-1',
      workspaceId: 'ws-1',
      triggerAnnotationId: 'anno-1',
    })
    expect(approveAnnotation).toHaveBeenCalledTimes(1)
    expect(approveAnnotation).toHaveBeenCalledWith({ annotationId: 'anno-1' })
  })

  it('is idempotent — registering twice fires each reaction once', async () => {
    registerBillingSubscribers()
    registerBillingSubscribers()
    await dispatchDomainEvent('annotation.approved', {
      annotationId: 'anno-2',
      submitterUserId: 'sub-2',
      workspaceId: 'ws-2',
    })
    expect(scanInviteRewardOnApproval).toHaveBeenCalledTimes(1)
    expect(approveAnnotation).toHaveBeenCalledTimes(1)
  })

  it('is best-effort — a failing accrual does not reject dispatch and the scan still fires', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(approveAnnotation).mockRejectedValueOnce(new Error('db down'))
    registerBillingSubscribers()
    await expect(
      dispatchDomainEvent('annotation.approved', {
        annotationId: 'anno-3',
        submitterUserId: 'sub-3',
        workspaceId: 'ws-3',
      }),
    ).resolves.toBeUndefined()
    expect(scanInviteRewardOnApproval).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
