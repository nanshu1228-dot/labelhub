import { pgEnum } from 'drizzle-orm/pg-core'

export const workflowStageEnum = pgEnum('workflow_stage', [
  'drafting',
  'revising',
  'submitted',
  /**
   * Finals P2 D9 — AI Review Agent verdict in flight. The submit
   * after-hook moves topics here when an ai_submission_verdicts row
   * is `pending`; the same hook advances to `reviewing` / `drafting`
   * once Claude returns. DB-side enum value was applied in the
   * D1 migration (drizzle/0001_finals).
   */
  'ai_review',
  'reviewing',
  /**
   * QC has passed but admin acceptance is pending. Lives between the
   * QC stage and final acceptance — added when the 3-role flow
   * (annotator/qc/admin) landed. Skipped when admin acts directly on
   * a 'submitted' annotation (admin can collapse QC + acceptance).
   */
  'awaiting_acceptance',
  'approved',
  'rejected',
])

export const taskStatusEnum = pgEnum('task_status', [
  'draft',
  'open',
  'paused',
  'closed',
  'archived',
])
