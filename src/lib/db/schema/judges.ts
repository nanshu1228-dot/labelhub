import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  real,
  index,
} from 'drizzle-orm/pg-core'

import { annotations, users, workspaces } from './core'

// =================================================================
// LLM-as-Judge — configure a model judge + run it against human
// annotations to measure agreement.
//
// Three tables:
//   llm_judges      — judge config (model, system prompt, owner)
//   judge_runs      — one execution batch over N sampled annotations
//   judge_verdicts  — judge's verdict on one annotation + agreement math
//
// Flow:
//   admin creates a judge (model, prompt) → admin clicks "run on N
//   submitted annotations" → server picks N samples randomly, runs
//   the judge model on each, stores its verdict, computes agreement
//   with the human → shows aggregate + per-rubric breakdown.
//
// This is the bridge between "annotation platform" (human labels) and
// "evals platform" (LLM judge) — admins can iterate on judge prompts
// against frozen human-gold sets.
// =================================================================
export const llmJudges = pgTable(
  'llm_judges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** Admin-friendly name, e.g. "Sonnet 4.6 — strict factuality". */
    name: text('name').notNull(),
    /** Tier passed to lib/ai/client.chat: 'fast' | 'default' | 'premium'.
     *  Lets admins compare Haiku vs Sonnet vs Opus against the same prompt. */
    tier: text('tier').notNull(),
    /** System prompt the judge will receive. Admins can compose this by
     *  hand or have the platform generate it from the workspace's rubric. */
    systemPrompt: text('system_prompt').notNull(),
    createdBy: uuid('created_by')
      .references(() => users.id)
      .notNull(),
    /** Soft-delete — judges with run history are never hard-deleted so
     *  the agreement curves stay intact. */
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index('llm_judges_workspace_idx').on(table.workspaceId),
  }),
)

export const judgeRuns = pgTable(
  'judge_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    judgeId: uuid('judge_id')
      .references(() => llmJudges.id)
      .notNull(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** 'running' | 'completed' | 'failed' — set at run start, flipped at end. */
    status: text('status').default('running').notNull(),
    /** How many human-annotated samples this run intended to cover.
     *  Actual `judge_verdicts` row count may be lower if some failed. */
    sampleCount: integer('sample_count').notNull(),
    /** Mean agreement across all completed verdicts in this run.
     *  Null until the run completes. */
    agreementScore: real('agreement_score'),
    /** Surface-friendly error if `status === 'failed'`. */
    errorText: text('error_text'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
  },
  (table) => ({
    judgeIdx: index('judge_runs_judge_idx').on(table.judgeId),
    workspaceIdx: index('judge_runs_workspace_idx').on(table.workspaceId),
  }),
)

export const judgeVerdicts = pgTable(
  'judge_verdicts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    judgeRunId: uuid('judge_run_id')
      .references(() => judgeRuns.id)
      .notNull(),
    /** The human annotation this verdict is paired against. */
    annotationId: uuid('annotation_id')
      .references(() => annotations.id)
      .notNull(),
    /** Judge's full structured response — same shape as a human
     *  annotation payload for the relevant mode. */
    judgePayload: jsonb('judge_payload').notNull(),
    /** Overall agreement in 0-1 range. */
    agreementScore: real('agreement_score').notNull(),
    /** Per-rubric agreement breakdown: { [rubricId]: 0..1 }. */
    perRubricBreakdown: jsonb('per_rubric_breakdown').notNull(),
    /** Tokens consumed (for cost tracking + admin's "is this judge
     *  expensive?" view). */
    tokensIn: integer('tokens_in').notNull(),
    tokensOut: integer('tokens_out').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index('judge_verdicts_run_idx').on(table.judgeRunId),
    annIdx: index('judge_verdicts_ann_idx').on(table.annotationId),
  }),
)
