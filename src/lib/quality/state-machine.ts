/**
 * Workflow-stage state machine — Finals P3 D12.
 *
 * Spec 4.5 demands an auditable state machine for annotation
 * lifecycle. Until D12 the transitions were enforced ad-hoc inside
 * each server action (qcReviewAnnotation, reviewAnnotation,
 * submitAnnotation, scheduleAIReviewIfMissing). This module is the
 * canonical source of truth — any actor calls `applyTransition()`
 * with a current stage + action + role; illegal moves throw.
 *
 * Pure functions only. No DB, no React, no Drizzle imports — so the
 * machine can be unit-tested in isolation and re-used by future
 * surfaces (Reviewer batch ops, AI scheduler, REST API).
 *
 *   drafting ─┬─ submit (annotator)
 *             └─ skip-ai (admin only, optional)
 *                ↓                ↓
 *              ai_review       submitted
 *                ↓                ↓
 *              ai_pass / ai_send_back / ai_human_review / ai_fail
 *                ↓                ↓
 *              reviewing       reviewing
 *                ↓
 *           qc_pass / qc_request_revision
 *                ↓                ↓
 *           awaiting_acceptance   revising
 *                ↓                ↓
 *           accept / reject     submit (back to ai_review / reviewing)
 *                ↓
 *           approved / rejected   (terminal)
 *
 * 13 documented transitions across 4 roles (annotator, ai, qc, admin).
 * Idempotency: applying the same transition twice from the SAME source
 * state is a no-op (returns the same `next` and a `noop: true` flag).
 */

import type { WorkflowStage } from '@/lib/templates/types'

export type Actor = 'annotator' | 'ai' | 'qc' | 'admin'

export type StageAction =
  /** Annotator submits a draft. */
  | 'submit'
  /** Admin / scheduler bypasses AI (custom-designer with aiAgent.enabled=false). */
  | 'skip_ai'
  /** AI agent verdict: pass. */
  | 'ai_pass'
  /** AI agent verdict: send_back. */
  | 'ai_send_back'
  /** AI agent verdict: human_review (lands in reviewing with priority). */
  | 'ai_human_review'
  /** AI agent threw or exhausted retries. */
  | 'ai_fail'
  /** QC reviewer passes a submission. */
  | 'qc_pass'
  /** QC reviewer asks for revisions. */
  | 'qc_request_revision'
  /** Admin terminal accept. */
  | 'admin_accept'
  /** Admin terminal reject. */
  | 'admin_reject'
  /** Annotator finishes a revision pass. */
  | 'resubmit'

export interface Transition {
  from: WorkflowStage
  action: StageAction
  to: WorkflowStage
  /** Which roles may take this action. */
  roles: Actor[]
}

const TRANSITIONS: readonly Transition[] = [
  // Annotator path
  { from: 'drafting', action: 'submit', to: 'ai_review', roles: ['annotator'] },
  // Admin opt-out of AI agent for this task — straight to submitted.
  { from: 'drafting', action: 'skip_ai', to: 'submitted', roles: ['admin', 'ai'] },
  // Revising loop — second-submit path mirrors the first.
  { from: 'revising', action: 'resubmit', to: 'ai_review', roles: ['annotator'] },
  { from: 'revising', action: 'skip_ai', to: 'submitted', roles: ['admin', 'ai'] },

  // AI agent paths (out of ai_review)
  { from: 'ai_review', action: 'ai_pass', to: 'reviewing', roles: ['ai'] },
  { from: 'ai_review', action: 'ai_send_back', to: 'drafting', roles: ['ai'] },
  // human_review still goes to 'reviewing' but the verdict carries the
  // __priority flag so the queue sorts them first.
  { from: 'ai_review', action: 'ai_human_review', to: 'reviewing', roles: ['ai'] },
  // Agent failure rolls back to submitted so a human can take over.
  { from: 'ai_review', action: 'ai_fail', to: 'submitted', roles: ['ai'] },

  // Submitted-stage entry to reviewing (when AI agent is off)
  { from: 'submitted', action: 'qc_pass', to: 'awaiting_acceptance', roles: ['qc', 'admin'] },
  { from: 'submitted', action: 'qc_request_revision', to: 'revising', roles: ['qc', 'admin'] },
  { from: 'submitted', action: 'admin_accept', to: 'approved', roles: ['admin'] },
  { from: 'submitted', action: 'admin_reject', to: 'rejected', roles: ['admin'] },

  // Reviewing-stage (post-AI)
  { from: 'reviewing', action: 'qc_pass', to: 'awaiting_acceptance', roles: ['qc', 'admin'] },
  { from: 'reviewing', action: 'qc_request_revision', to: 'revising', roles: ['qc', 'admin'] },
  { from: 'reviewing', action: 'admin_accept', to: 'approved', roles: ['admin'] },
  { from: 'reviewing', action: 'admin_reject', to: 'rejected', roles: ['admin'] },

  // Awaiting acceptance (post-QC)
  { from: 'awaiting_acceptance', action: 'admin_accept', to: 'approved', roles: ['admin'] },
  { from: 'awaiting_acceptance', action: 'admin_reject', to: 'rejected', roles: ['admin'] },
  { from: 'awaiting_acceptance', action: 'qc_request_revision', to: 'revising', roles: ['admin'] },
]

/** Public lookup: every transition the machine accepts. */
export function listTransitions(): readonly Transition[] {
  return TRANSITIONS
}

/**
 * Find the transition for `(from, action)`. Returns undefined when
 * the action is illegal from the given source stage.
 */
export function findTransition(
  from: WorkflowStage,
  action: StageAction,
): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.action === action)
}

export class IllegalTransitionError extends Error {
  constructor(public readonly from: WorkflowStage, public readonly action: StageAction) {
    super(`Illegal transition: ${from} → (${action}). No matching rule.`)
    this.name = 'IllegalTransitionError'
  }
}

export class ForbiddenRoleError extends Error {
  constructor(
    public readonly action: StageAction,
    public readonly role: Actor,
    public readonly allowed: Actor[],
  ) {
    super(
      `Role '${role}' cannot perform '${action}' (allowed: ${allowed.join(', ')})`,
    )
    this.name = 'ForbiddenRoleError'
  }
}

export interface ApplyResult {
  from: WorkflowStage
  to: WorkflowStage
  action: StageAction
  noop: boolean
}

/**
 * Apply a transition. Throws IllegalTransitionError on an unknown
 * (from, action) pair; throws ForbiddenRoleError when the actor's
 * role isn't in the transition's `roles` allow-list. Idempotency:
 * applying the same action when the topic is ALREADY in the target
 * state returns `{ noop: true, to: from }` so concurrent double-
 * clicks don't double-fire side effects.
 */
export function applyTransition(args: {
  from: WorkflowStage
  action: StageAction
  role: Actor
}): ApplyResult {
  const t = findTransition(args.from, args.action)
  if (!t) {
    // Idempotency for TERMINAL stages only. accepting/rejecting an
    // already-approved/rejected annotation is a benign no-op (e.g.,
    // reviewer double-clicked). Mid-stream "self-loop" calls (like
    // ai_send_back from drafting, or qc_request_revision from
    // revising) are NOT treated as no-ops — drafting could be a
    // fresh state, not a sent-back state, and conflating them would
    // mask real bugs.
    const TERMINAL_STAGES = new Set<WorkflowStage>(['approved', 'rejected'])
    const idempotent =
      TERMINAL_STAGES.has(args.from) &&
      TRANSITIONS.find(
        (cand) => cand.action === args.action && cand.to === args.from,
      )
    if (idempotent) {
      // Same-state arrival → no-op. Still gate on role so a forged
      // role can't probe.
      if (!idempotent.roles.includes(args.role)) {
        throw new ForbiddenRoleError(args.action, args.role, idempotent.roles)
      }
      return {
        from: args.from,
        to: args.from,
        action: args.action,
        noop: true,
      }
    }
    throw new IllegalTransitionError(args.from, args.action)
  }
  if (!t.roles.includes(args.role)) {
    throw new ForbiddenRoleError(args.action, args.role, t.roles)
  }
  return {
    from: args.from,
    to: t.to,
    action: args.action,
    noop: false,
  }
}

/**
 * Convenience: list every legal action from a given source state
 * for a given actor. Used by UI buttons to render disabled state
 * for impossible moves.
 */
export function legalActions(
  from: WorkflowStage,
  role: Actor,
): StageAction[] {
  return TRANSITIONS.filter(
    (t) => t.from === from && t.roles.includes(role),
  ).map((t) => t.action)
}

/**
 * Pure predicate — is this `(from → to)` move ever legal? Doesn't
 * inspect role. Used by the audit timeline to flag "expected" vs
 * "unexpected" transitions in event logs.
 */
export function isLegalStagePair(
  from: WorkflowStage,
  to: WorkflowStage,
): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.to === to)
}
