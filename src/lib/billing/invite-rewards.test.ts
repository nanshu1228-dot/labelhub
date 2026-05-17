import { describe, it, expect } from 'vitest'
import {
  decideInviteRewardAbuse,
  INVITE_REWARD_FAST_THRESHOLD_HOURS,
} from './invite-rewards'

describe('decideInviteRewardAbuse — allow', () => {
  it('allows when public-domain emails, active inviter, slow threshold', () => {
    const d = decideInviteRewardAbuse({
      inviterEmail: 'alice@gmail.com',
      inviteeEmail: 'bob@qq.com',
      inviterTrustStatus: 'active',
      hoursSinceJoin: 72,
    })
    expect(d.kind).toBe('allow')
  })

  it('allows when both on same public domain (common case, not collusion)', () => {
    const d = decideInviteRewardAbuse({
      inviterEmail: 'a@gmail.com',
      inviteeEmail: 'b@gmail.com',
      inviterTrustStatus: 'active',
      hoursSinceJoin: 168,
    })
    expect(d.kind).toBe('allow')
  })

  it('allows when invitee email is missing (defensive)', () => {
    const d = decideInviteRewardAbuse({
      inviterEmail: 'alice@gmail.com',
      inviteeEmail: '',
      inviterTrustStatus: 'active',
      hoursSinceJoin: 100,
    })
    // Empty domain doesn't match anything; allow through (the upstream
    // sign-up flow guarantees email so this shouldn't happen anyway).
    expect(d.kind).toBe('allow')
  })
})

describe('decideInviteRewardAbuse — manual_review', () => {
  it('flags same private domain as suspected collusion', () => {
    const d = decideInviteRewardAbuse({
      inviterEmail: 'alice@acme.com',
      inviteeEmail: 'bob@acme.com',
      inviterTrustStatus: 'active',
      hoursSinceJoin: 200,
    })
    expect(d.kind).toBe('manual_review')
    if (d.kind === 'manual_review') {
      expect(d.reason).toMatch(/acme\.com/)
    }
  })

  it('flags suspiciously fast threshold (within fast-window)', () => {
    const d = decideInviteRewardAbuse({
      inviterEmail: 'alice@gmail.com',
      inviteeEmail: 'bob@gmail.com',
      inviterTrustStatus: 'active',
      hoursSinceJoin: INVITE_REWARD_FAST_THRESHOLD_HOURS - 1,
    })
    expect(d.kind).toBe('manual_review')
    if (d.kind === 'manual_review') {
      expect(d.reason).toMatch(/suspiciously fast/)
    }
  })

  it('flags at fast-window boundary minus 1 hour (still suspicious)', () => {
    const d = decideInviteRewardAbuse({
      inviterEmail: 'alice@gmail.com',
      inviteeEmail: 'bob@gmail.com',
      inviterTrustStatus: 'active',
      hoursSinceJoin: 0.5,
    })
    expect(d.kind).toBe('manual_review')
  })
})

describe('decideInviteRewardAbuse — block', () => {
  it('blocks when inviter is suspended', () => {
    const d = decideInviteRewardAbuse({
      inviterEmail: 'alice@gmail.com',
      inviteeEmail: 'bob@qq.com',
      inviterTrustStatus: 'suspended',
      hoursSinceJoin: 168,
    })
    expect(d.kind).toBe('block')
    if (d.kind === 'block') {
      expect(d.reason).toMatch(/suspended/i)
    }
  })

  it('blocks even when other allow conditions hold', () => {
    // Same domain would normally be manual_review, but suspended wins.
    const d = decideInviteRewardAbuse({
      inviterEmail: 'a@acme.com',
      inviteeEmail: 'b@acme.com',
      inviterTrustStatus: 'suspended',
      hoursSinceJoin: 0.1,
    })
    expect(d.kind).toBe('block')
  })
})

describe('decideInviteRewardAbuse — ordering of rules', () => {
  it('domain collusion check fires before fast-window check (gives more specific reason)', () => {
    const d = decideInviteRewardAbuse({
      inviterEmail: 'a@acme.com',
      inviteeEmail: 'b@acme.com',
      inviterTrustStatus: 'active',
      hoursSinceJoin: 1, // also suspicious
    })
    expect(d.kind).toBe('manual_review')
    if (d.kind === 'manual_review') {
      // domain reason wins because it's more actionable
      expect(d.reason).toMatch(/acme\.com/)
    }
  })

  it('case-insensitive domain match', () => {
    const d = decideInviteRewardAbuse({
      inviterEmail: 'ALICE@Acme.COM',
      inviteeEmail: 'bob@acme.com',
      inviterTrustStatus: 'active',
      hoursSinceJoin: 200,
    })
    expect(d.kind).toBe('manual_review')
  })
})
