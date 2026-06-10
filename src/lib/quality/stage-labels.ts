/**
 * Chinese display labels + pipeline-stepper mapping for workflow stages.
 *
 * Pure (no React, no server-only) so it's shared by the review detail
 * stepper, the verdict controls, and the review queue. Mirrors the
 * spec-9.3 pipeline: 提交 → AI预审 → 初审 → 终审 → 入库.
 */

import type { WorkflowStage } from '@/lib/templates/types'

/** Short Chinese label for a single workflow stage. */
export function stageLabel(status: WorkflowStage | string): string {
  switch (status) {
    case 'drafting':
      return '草拟中'
    case 'revising':
      return '修订中'
    case 'submitted':
      return '待初审'
    case 'ai_review':
      return 'AI 预审中'
    case 'reviewing':
      return '待初审'
    case 'awaiting_acceptance':
      return '待终审'
    case 'approved':
      return '已入库'
    case 'rejected':
      return '已拒绝'
    default:
      return String(status)
  }
}

export interface StepperState {
  steps: string[]
  /** Index of the in-flight step; every earlier step is done. */
  activeIndex: number
  /** Terminal approved → whole pipeline done. */
  done: boolean
  /** Terminal rejected → pipeline stopped. */
  rejected: boolean
}

/**
 * Map a workflow stage onto the linear pipeline shown in the review UI.
 * Two-stage tasks split human review into 初审 / 终审; single-stage tasks
 * collapse it into one 审核 step (spec 9.3 vs the lighter path).
 */
export function stepperState(
  status: WorkflowStage | string,
  twoStage: boolean,
): StepperState {
  const steps = twoStage
    ? ['提交', 'AI 预审', '初审', '终审', '入库']
    : ['提交', 'AI 预审', '审核', '入库']

  const lastIdx = steps.length - 1
  const firstReviewIdx = 2 // '初审' or '审核'
  const finalReviewIdx = twoStage ? 3 : 2 // '终审' or '审核'

  let activeIndex: number
  let done = false
  const rejected = status === 'rejected'

  switch (status) {
    case 'drafting':
    case 'revising':
      activeIndex = 0
      break
    case 'submitted':
    case 'ai_review':
      activeIndex = 1
      break
    case 'reviewing':
      activeIndex = firstReviewIdx
      break
    case 'awaiting_acceptance':
      activeIndex = finalReviewIdx
      break
    case 'approved':
      activeIndex = lastIdx
      done = true
      break
    case 'rejected':
      // Stops wherever it was; surface as the review step.
      activeIndex = firstReviewIdx
      break
    default:
      activeIndex = 0
  }

  return { steps, activeIndex, done, rejected }
}
