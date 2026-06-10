import { describe, it, expect } from 'vitest'
import {
  applyTransition,
  findTransition,
  ForbiddenRoleError,
  IllegalTransitionError,
  isBlockedByPolicy,
  isLegalStagePair,
  legalActions,
  listTransitions,
  PolicyViolationError,
  type Actor,
  type StageAction,
} from './state-machine'
import type { WorkflowStage } from '@/lib/templates/types'

/**
 * State-machine unit tests — Finals P3 D12.
 *
 * The gate (per plan): "every legal transition (~22), every illegal
 * (~30), idempotency under double-click (~5)". This file exercises
 * the matrix exhaustively — adding a transition without a test
 * shows up as a missing row, and adding an action without an
 * exhaustive role check shows up as a missing ForbiddenRoleError
 * case.
 */

const STAGES: WorkflowStage[] = [
  'drafting',
  'revising',
  'submitted',
  'ai_review',
  'reviewing',
  'awaiting_acceptance',
  'approved',
  'rejected',
]

const ACTIONS: StageAction[] = [
  'submit',
  'skip_ai',
  'ai_pass',
  'ai_send_back',
  'ai_human_review',
  'ai_fail',
  'qc_pass',
  'qc_request_revision',
  'admin_accept',
  'admin_reject',
  'resubmit',
]

describe('listTransitions — completeness', () => {
  it('returns the documented set of transitions', () => {
    // 20 rules cover the full lifecycle: the two-phase submit entry
    // (submit → submitted, then ai_start → ai_review) plus the AI / QC /
    // admin verdict edges.
    const ts = listTransitions()
    expect(ts.length).toBe(20)
  })

  it('every transition has a non-empty roles array', () => {
    for (const t of listTransitions()) {
      expect(t.roles.length).toBeGreaterThan(0)
    }
  })

  it('every (from, action) pair has at most one rule', () => {
    const seen = new Set<string>()
    for (const t of listTransitions()) {
      const key = `${t.from}|${t.action}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })
})

describe('applyTransition — legal moves', () => {
  it('annotator submit: drafting → submitted (AI scheduler promotes later)', () => {
    const r = applyTransition({ from: 'drafting', action: 'submit', role: 'annotator' })
    expect(r.to).toBe('submitted')
    expect(r.noop).toBe(false)
  })

  it('ai_start: submitted → ai_review (scheduler enqueues into AI review)', () => {
    const r = applyTransition({ from: 'submitted', action: 'ai_start', role: 'ai' })
    expect(r.to).toBe('ai_review')
    expect(r.noop).toBe(false)
  })

  it('annotator resubmit: revising → submitted (AI scheduler promotes later)', () => {
    const r = applyTransition({ from: 'revising', action: 'resubmit', role: 'annotator' })
    expect(r.to).toBe('submitted')
  })

  it('admin skip_ai: drafting → submitted', () => {
    const r = applyTransition({ from: 'drafting', action: 'skip_ai', role: 'admin' })
    expect(r.to).toBe('submitted')
  })

  it('AI agent pass: ai_review → reviewing', () => {
    const r = applyTransition({ from: 'ai_review', action: 'ai_pass', role: 'ai' })
    expect(r.to).toBe('reviewing')
  })

  it('AI agent send_back: ai_review → drafting', () => {
    const r = applyTransition({ from: 'ai_review', action: 'ai_send_back', role: 'ai' })
    expect(r.to).toBe('drafting')
  })

  it('AI agent human_review: ai_review → reviewing (priority)', () => {
    const r = applyTransition({ from: 'ai_review', action: 'ai_human_review', role: 'ai' })
    expect(r.to).toBe('reviewing')
  })

  it('AI agent failure: ai_review → submitted', () => {
    const r = applyTransition({ from: 'ai_review', action: 'ai_fail', role: 'ai' })
    expect(r.to).toBe('submitted')
  })

  it('QC pass from submitted → awaiting_acceptance', () => {
    const r = applyTransition({ from: 'submitted', action: 'qc_pass', role: 'qc' })
    expect(r.to).toBe('awaiting_acceptance')
  })

  it('QC pass from reviewing → awaiting_acceptance', () => {
    const r = applyTransition({ from: 'reviewing', action: 'qc_pass', role: 'qc' })
    expect(r.to).toBe('awaiting_acceptance')
  })

  it('QC request_revision from submitted → revising', () => {
    const r = applyTransition({
      from: 'submitted',
      action: 'qc_request_revision',
      role: 'qc',
    })
    expect(r.to).toBe('revising')
  })

  it('QC request_revision from reviewing → revising', () => {
    const r = applyTransition({
      from: 'reviewing',
      action: 'qc_request_revision',
      role: 'qc',
    })
    expect(r.to).toBe('revising')
  })

  it('admin accept from any QC-able stage → approved', () => {
    for (const from of ['submitted', 'reviewing', 'awaiting_acceptance'] as const) {
      const r = applyTransition({ from, action: 'admin_accept', role: 'admin' })
      expect(r.to).toBe('approved')
    }
  })

  it('admin reject from any QC-able stage → rejected', () => {
    for (const from of ['submitted', 'reviewing', 'awaiting_acceptance'] as const) {
      const r = applyTransition({ from, action: 'admin_reject', role: 'admin' })
      expect(r.to).toBe('rejected')
    }
  })

  it('admin request_revision from awaiting_acceptance → revising', () => {
    const r = applyTransition({
      from: 'awaiting_acceptance',
      action: 'qc_request_revision',
      role: 'admin',
    })
    expect(r.to).toBe('revising')
  })
})

describe('applyTransition — role gating', () => {
  it('annotator cannot pass QC', () => {
    expect(() =>
      applyTransition({ from: 'submitted', action: 'qc_pass', role: 'annotator' }),
    ).toThrow(ForbiddenRoleError)
  })

  it('annotator cannot accept (admin only)', () => {
    expect(() =>
      applyTransition({ from: 'reviewing', action: 'admin_accept', role: 'annotator' }),
    ).toThrow(ForbiddenRoleError)
  })

  it('qc cannot terminal-accept (admin only)', () => {
    expect(() =>
      applyTransition({ from: 'reviewing', action: 'admin_accept', role: 'qc' }),
    ).toThrow(ForbiddenRoleError)
  })

  it('qc cannot terminal-reject (admin only)', () => {
    expect(() =>
      applyTransition({ from: 'reviewing', action: 'admin_reject', role: 'qc' }),
    ).toThrow(ForbiddenRoleError)
  })

  it('ai cannot QC-pass (humans only)', () => {
    expect(() =>
      applyTransition({ from: 'submitted', action: 'qc_pass', role: 'ai' }),
    ).toThrow(ForbiddenRoleError)
  })

  it('qc cannot fire ai_pass (system-only)', () => {
    expect(() =>
      applyTransition({ from: 'ai_review', action: 'ai_pass', role: 'qc' }),
    ).toThrow(ForbiddenRoleError)
  })

  it('admin cannot fire ai_pass (only ai role)', () => {
    expect(() =>
      applyTransition({ from: 'ai_review', action: 'ai_pass', role: 'admin' }),
    ).toThrow(ForbiddenRoleError)
  })

  it('only annotator can submit a draft', () => {
    for (const role of ['ai', 'qc', 'admin'] as const) {
      expect(() =>
        applyTransition({ from: 'drafting', action: 'submit', role }),
      ).toThrow(ForbiddenRoleError)
    }
  })
})

describe('applyTransition — illegal moves', () => {
  it('cannot QC-pass an approved annotation (terminal)', () => {
    expect(() =>
      applyTransition({ from: 'approved', action: 'qc_pass', role: 'admin' }),
    ).toThrow(IllegalTransitionError)
  })

  it('cannot resubmit an approved annotation', () => {
    expect(() =>
      applyTransition({ from: 'approved', action: 'resubmit', role: 'annotator' }),
    ).toThrow(IllegalTransitionError)
  })

  it('cannot fire ai_send_back from drafting (not in ai_review)', () => {
    expect(() =>
      applyTransition({ from: 'drafting', action: 'ai_send_back', role: 'ai' }),
    ).toThrow(IllegalTransitionError)
  })

  it('cannot accept a draft directly (must go through review path)', () => {
    expect(() =>
      applyTransition({ from: 'drafting', action: 'admin_accept', role: 'admin' }),
    ).toThrow(IllegalTransitionError)
  })

  it('cannot submit from submitted (double-submit)', () => {
    expect(() =>
      applyTransition({ from: 'submitted', action: 'submit', role: 'annotator' }),
    ).toThrow()
  })

  it('cannot resubmit from drafting (different action)', () => {
    expect(() =>
      applyTransition({ from: 'drafting', action: 'resubmit', role: 'annotator' }),
    ).toThrow(IllegalTransitionError)
  })

  it('matrix sweep: every illegal pair throws (excl. terminal idempotency)', () => {
    let illegal = 0
    const TERMINAL = new Set(['approved', 'rejected'])
    for (const from of STAGES) {
      for (const action of ACTIONS) {
        const legal = !!findTransition(from, action)
        if (legal) continue
        // Skip the terminal-stage idempotent no-op cases — they're
        // intentionally not errors. e.g. (approved, admin_accept).
        if (
          TERMINAL.has(from) &&
          listTransitions().some(
            (t) => t.action === action && t.to === from,
          )
        ) {
          continue
        }
        illegal++
        // Use the 'admin' role so role-gating never accidentally
        // converts an illegal pair into ForbiddenRoleError before
        // the IllegalTransition path fires. (admin is allowed on
        // every transition that exists.)
        expect(() =>
          applyTransition({ from, action, role: 'admin' }),
        ).toThrow()
      }
    }
    expect(illegal).toBeGreaterThanOrEqual(30)
  })
})

describe('applyTransition — idempotency', () => {
  it('admin accept twice from approved is a no-op (already there)', () => {
    const r = applyTransition({
      from: 'approved',
      action: 'admin_accept',
      role: 'admin',
    })
    expect(r.noop).toBe(true)
    expect(r.to).toBe('approved')
  })

  it('admin reject twice from rejected is a no-op', () => {
    const r = applyTransition({
      from: 'rejected',
      action: 'admin_reject',
      role: 'admin',
    })
    expect(r.noop).toBe(true)
    expect(r.to).toBe('rejected')
  })

  it('qc_pass when already in awaiting_acceptance throws (NOT idempotent — mid-stream)', () => {
    // Mid-stream stages don't get idempotent no-ops because the
    // current state alone can't prove the action already ran.
    // Only terminal approved/rejected get the no-op semantics.
    expect(() =>
      applyTransition({
        from: 'awaiting_acceptance',
        action: 'qc_pass',
        role: 'qc',
      }),
    ).toThrow(IllegalTransitionError)
  })

  it('qc_request_revision when already in revising throws (NOT idempotent)', () => {
    expect(() =>
      applyTransition({
        from: 'revising',
        action: 'qc_request_revision',
        role: 'qc',
      }),
    ).toThrow(IllegalTransitionError)
  })

  it('ai_pass when already in reviewing throws (NOT idempotent)', () => {
    expect(() =>
      applyTransition({
        from: 'reviewing',
        action: 'ai_pass',
        role: 'ai',
      }),
    ).toThrow(IllegalTransitionError)
  })

  it('idempotent no-op still gates roles', () => {
    expect(() =>
      applyTransition({
        from: 'approved',
        action: 'admin_accept',
        role: 'annotator',
      }),
    ).toThrow(ForbiddenRoleError)
  })
})

describe('legalActions / isLegalStagePair', () => {
  it('annotator gets [submit] from drafting', () => {
    expect(legalActions('drafting', 'annotator')).toEqual(['submit'])
  })

  it('qc has multiple actions in reviewing', () => {
    const actions = legalActions('reviewing', 'qc')
    expect(actions).toContain('qc_pass')
    expect(actions).toContain('qc_request_revision')
  })

  it('annotator has no actions in approved (terminal)', () => {
    expect(legalActions('approved', 'annotator')).toEqual([])
  })

  it('isLegalStagePair recognizes legal transitions', () => {
    expect(isLegalStagePair('drafting', 'submitted')).toBe(true)
    expect(isLegalStagePair('submitted', 'ai_review')).toBe(true)
    expect(isLegalStagePair('ai_review', 'reviewing')).toBe(true)
    expect(isLegalStagePair('reviewing', 'approved')).toBe(true)
  })

  it('isLegalStagePair rejects illegal jumps', () => {
    expect(isLegalStagePair('drafting', 'approved')).toBe(false)
    expect(isLegalStagePair('approved', 'drafting')).toBe(false)
  })
})

describe('two-stage review policy (spec 9.3)', () => {
  const twoStage = { twoStage: true }
  const single = { twoStage: false }

  it('blocks admin_accept straight from submitted under two-stage', () => {
    expect(() =>
      applyTransition({
        from: 'submitted',
        action: 'admin_accept',
        role: 'admin',
        policy: twoStage,
      }),
    ).toThrow(PolicyViolationError)
  })

  it('blocks admin_accept straight from reviewing under two-stage', () => {
    expect(() =>
      applyTransition({
        from: 'reviewing',
        action: 'admin_accept',
        role: 'admin',
        policy: twoStage,
      }),
    ).toThrow(PolicyViolationError)
  })

  it('ALLOWS admin_accept from awaiting_acceptance under two-stage (终审)', () => {
    const r = applyTransition({
      from: 'awaiting_acceptance',
      action: 'admin_accept',
      role: 'admin',
      policy: twoStage,
    })
    expect(r.to).toBe('approved')
  })

  it('does not block 打回 / reject under two-stage', () => {
    expect(
      applyTransition({
        from: 'submitted',
        action: 'admin_reject',
        role: 'admin',
        policy: twoStage,
      }).to,
    ).toBe('rejected')
    expect(
      applyTransition({
        from: 'reviewing',
        action: 'qc_request_revision',
        role: 'admin',
        policy: twoStage,
      }).to,
    ).toBe('revising')
  })

  it('single-stage (twoStage:false) keeps the direct admin_accept', () => {
    expect(
      applyTransition({
        from: 'submitted',
        action: 'admin_accept',
        role: 'admin',
        policy: single,
      }).to,
    ).toBe('approved')
  })

  it('omitting policy is unchanged behaviour (direct accept allowed)', () => {
    expect(
      applyTransition({
        from: 'reviewing',
        action: 'admin_accept',
        role: 'admin',
      }).to,
    ).toBe('approved')
  })

  it('legalActions hides direct accept from submitted under two-stage', () => {
    expect(legalActions('submitted', 'admin', twoStage)).not.toContain(
      'admin_accept',
    )
    // QC pass + 打回 + reject remain.
    expect(legalActions('submitted', 'admin', twoStage)).toContain('qc_pass')
    // Single-stage still surfaces it.
    expect(legalActions('submitted', 'admin', single)).toContain('admin_accept')
  })

  it('isBlockedByPolicy is pure + only gates admin_accept from pre-QC stages', () => {
    expect(isBlockedByPolicy('submitted', 'admin_accept', twoStage)).toBe(true)
    expect(isBlockedByPolicy('awaiting_acceptance', 'admin_accept', twoStage)).toBe(
      false,
    )
    expect(isBlockedByPolicy('submitted', 'admin_reject', twoStage)).toBe(false)
    expect(isBlockedByPolicy('submitted', 'admin_accept', single)).toBe(false)
    expect(isBlockedByPolicy('submitted', 'admin_accept', undefined)).toBe(false)
  })
})

describe('exhaustive role-action coverage', () => {
  // Sanity check: every role × stage combination either succeeds
  // (legal + authorized) or throws ONE of the two known errors. No
  // unhandled exceptions.
  const ROLES: Actor[] = ['annotator', 'ai', 'qc', 'admin']
  it('never raises an unexpected error class', () => {
    for (const from of STAGES) {
      for (const action of ACTIONS) {
        for (const role of ROLES) {
          try {
            applyTransition({ from, action, role })
          } catch (e) {
            if (
              !(e instanceof IllegalTransitionError) &&
              !(e instanceof ForbiddenRoleError)
            ) {
              throw new Error(
                `Unexpected error class for ${from}/${action}/${role}: ${
                  e instanceof Error ? e.name : String(e)
                }`,
              )
            }
          }
        }
      }
    }
  })
})
