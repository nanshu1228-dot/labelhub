import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  real,
  boolean,
  index,
} from 'drizzle-orm/pg-core'

import { tasks, topics, users, workspaces } from './core'

// =================================================================
// Dawid-Skene EM truth inference — Phase-11.
//
// When ≥2 raters disagree on a cell (pair-rubric bool, arena-gsb 1-5),
// majority/median voting is fragile: if one rater is systematically
// biased, they outvote a single good rater. Dawid & Skene (1979)
// proposed an EM algorithm that jointly estimates per-rater class-
// confusion matrices and the latent true label. We run it on demand
// and persist the result so admins can read it without re-running EM
// on every page load.
//
// Three tables:
//   ds_consensus_runs   — one batch (the admin clicked "run DS")
//   ds_inferred_labels  — per-cell inferred class + posterior + confidence
//   ds_rater_confusion  — per-(run, rater) KxK confusion matrix + bias note
//
// A "cell" is the atom DS infers truth for:
//   pair-rubric → (topic, rubricId, side a|b) with K=2 classes (false/true)
//   arena-gsb   → (topic, dimId, side a|b)   with K=5 classes (1..5)
// =================================================================
export const dsConsensusRuns = pgTable(
  'ds_consensus_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** Optional task scope. Null = whole workspace, single mode. */
    taskId: uuid('task_id').references(() => tasks.id),
    /** Which template family this run covered. Mixed-mode runs are split. */
    templateMode: text('template_mode').notNull(),
    /** K — number of classes (2 for pair-rubric bool, 5 for arena-gsb). */
    numClasses: integer('num_classes').notNull(),
    /** How many distinct cells the EM inferred truth for. */
    cellCount: integer('cell_count').notNull(),
    /** Distinct raters seen in this run. */
    raterCount: integer('rater_count').notNull(),
    /** EM iterations completed. */
    iterations: integer('iterations').notNull(),
    /** True if EM hit the ε convergence threshold, false if it hit the cap. */
    converged: boolean('converged').notNull(),
    /** Final log-likelihood (monotonically non-decreasing across iters). */
    logLikelihood: real('log_likelihood').notNull(),
    /** Admin who triggered. Null for system / scheduled runs. */
    triggeredBy: uuid('triggered_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index('ds_runs_workspace_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
  }),
)

export const dsInferredLabels = pgTable(
  'ds_inferred_labels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .references(() => dsConsensusRuns.id, { onDelete: 'cascade' })
      .notNull(),
    topicId: uuid('topic_id')
      .references(() => topics.id)
      .notNull(),
    /** Compound key inside the topic. Encodes (mode, rubric/dim id, side):
     *  e.g. "pair:r_accuracy:a" or "arena:d_helpfulness:b". */
    cellKey: text('cell_key').notNull(),
    /** The DS-inferred class as an integer 0..K-1. UI maps back to display
     *  ('true'/'false' for K=2, '1'..'5' for K=5). */
    inferredClass: integer('inferred_class').notNull(),
    /** Posterior P(z=inferredClass | observations) — the "confidence" we
     *  surface in the UI. Always in [0, 1]. */
    confidence: real('confidence').notNull(),
    /** Full posterior over all K classes: { "0": p0, "1": p1, ... }. Lets
     *  the UI show the runner-up class on hover. */
    posterior: jsonb('posterior').notNull(),
    /** Distinct raters that voted on this cell. Diagnostic — DS still
     *  produces an estimate from a single rater but it's just that
     *  rater's prior shifted by the posterior. */
    voteCount: integer('vote_count').notNull(),
  },
  (table) => ({
    runIdx: index('ds_labels_run_idx').on(table.runId),
    topicIdx: index('ds_labels_topic_idx').on(table.topicId),
  }),
)

export const dsRaterConfusion = pgTable(
  'ds_rater_confusion',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .references(() => dsConsensusRuns.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** KxK matrix as number[][] — confusion[truth][observed] = probability.
     *  Each row sums to 1.0 (modulo float). For K=2 pair-rubric this is
     *  the 2x2 [[TN, FP], [FN, TP]] in row-stochastic form. */
    confusion: jsonb('confusion').notNull(),
    /** How many observations this rater contributed to the run. */
    nObservations: integer('n_observations').notNull(),
    /** Mean of the diagonal — uniform-prior expected accuracy across classes. */
    accuracy: real('accuracy').notNull(),
    /** Human-readable bias note, e.g. "false-pos 18%" or "biased toward 3".
     *  Null when matrix is well-balanced. */
    biasSummary: text('bias_summary'),
  },
  (table) => ({
    runIdx: index('ds_confusion_run_idx').on(table.runId),
    userIdx: index('ds_confusion_user_idx').on(table.userId),
  }),
)
