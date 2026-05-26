import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  real,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

/**
 * LabelHub schema — full Day 2 design.
 *
 * Data model adopted from ByteDance Xpert (proven by the largest player in the space):
 *   workspace → tasks → topics → annotations
 *
 * Plus our additions:
 *   - events (Pillar 2: event sourcing)
 *   - gold_standards (for trust score calibration)
 *   - trust_scores (per user × task type)
 *   - guidelines + guideline_patches (Living Guidelines)
 *
 * Optimistic concurrency: rows that can be edited by multiple actors carry a `version`
 * column. Updates use `WHERE id = ? AND version = ?` then bump version.
 */

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

// =================================================================
// Users (mirror of Supabase auth.users; we add profile fields here)
// =================================================================
export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // matches supabase auth.users.id
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// =================================================================
// Workspaces — admin-scoped containers, each pinned to one template mode
// =================================================================
export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  templateMode: text('template_mode').notNull(), // FK to in-code registry
  /**
   * Primary owner — keeps backward compat with code that reads `admin_id`
   * directly. Real authorization should go through `workspace_members`
   * (below) which supports multi-admin + finer roles.
   */
  adminId: uuid('admin_id')
    .references(() => users.id)
    .notNull(),
  settings: jsonb('settings').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// =================================================================
// Workspace members — many-to-many (user × workspace) with roles.
// Supersedes the old single-admin model. `workspaces.admin_id` is kept
// for backward compat but the source of truth for "can this user X?" is
// this table.
//
// Roles (small but stratified — each one is a strict superset of the next):
//   - 'admin'     — everything qc can do, PLUS workspace management
//                   (members, billing, keys, settings, connections) AND
//                   final acceptance review (approve/reject/打回 from
//                   awaiting_acceptance OR straight from submitted).
//   - 'qc'        — everything annotator can do, PLUS quality-check
//                   review on submitted annotations (qc_pass → escalate
//                   to admin for acceptance, OR 打回 to annotator).
//                   Can be a senior expert role, or admin can skip it
//                   and act as qc themselves.
//   - 'annotator' — claim topics, submit annotations, reply to review
//                   threads when their work was sent back.
//   - 'viewer'    — read-only; can see trajectories + annotations + analytics.
//
// Auth guards (`requireWorkspaceAdmin`, `requireWorkspaceQC`,
// `requireWorkspaceMember`) check this table.
// =================================================================
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    role: text('role').notNull(), // 'admin' | 'qc' | 'annotator' | 'viewer'
    /** Who invited this user (null for the workspace creator). */
    invitedBy: uuid('invited_by').references(() => users.id),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    /**
     * Trust lifecycle state (Phase-9). Orthogonal to `role` — role
     * gates what surfaces a user can SEE, trustStatus gates what
     * they can DO on those surfaces:
     *   'active'     — default. Can claim topics, earn payouts.
     *   'probation'  — can claim + submit, but admin reviews every
     *                   verdict before payout (extra QC scrutiny).
     *                   Admin sets this when trust drops below
     *                   threshold or after a critical violation.
     *   'suspended'  — cannot claim new topics; existing drafts can
     *                   still be submitted (so they aren't lost) but
     *                   payouts halt. Reversible by admin.
     * Stored as plain text + an in-code enum (no pg enum) to avoid
     * a migration when we add 'banned' or 'graduated' later. */
    trustStatus: text('trust_status').default('active').notNull(),
    /** Free-form reason the admin gave when changing status — surfaced
     *  to the rater verbatim in their /my/quality page. */
    trustStatusReason: text('trust_status_reason'),
    /** When the current status started — null for default 'active'. */
    trustStatusAt: timestamp('trust_status_at'),
    /** Who flipped the status (admin id). Null for default 'active'. */
    trustStatusBy: uuid('trust_status_by').references(() => users.id),
  },
  (table) => ({
    wsUserUniq: uniqueIndex('ws_members_ws_user_uniq').on(
      table.workspaceId,
      table.userId,
    ),
    userIdx: index('ws_members_user_idx').on(table.userId),
    roleIdx: index('ws_members_role_idx').on(table.workspaceId, table.role),
  }),
)

// =================================================================
// Workspace invites — outstanding invites for users who haven't signed up
// yet (matched by email at sign-in). When a user signs up with a matching
// email, the invite is consumed and a `workspace_members` row is created.
// =================================================================
export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** Lowercased before storage. Match on insert + on sign-in lookup. */
    email: text('email').notNull(),
    role: text('role').notNull(),
    invitedBy: uuid('invited_by')
      .references(() => users.id)
      .notNull(),
    /** UUID token the user clicks in their email; null = link not yet generated. */
    token: text('token').notNull(),
    acceptedAt: timestamp('accepted_at'),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    tokenUniq: uniqueIndex('ws_invites_token_uniq').on(table.token),
    wsEmailIdx: index('ws_invites_ws_email_idx').on(
      table.workspaceId,
      table.email,
    ),
  }),
)

// =================================================================
// Tasks — published units of work inside a workspace
// =================================================================
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    name: text('name').notNull(),
    phase: integer('phase').notNull().default(1), // 一期/二期/三期...
    description: text('description'),
    guidelinesMarkdown: text('guidelines_markdown'),
    templateMode: text('template_mode').notNull(),
    rewardConfig: jsonb('reward_config').notNull(), // shape matches templates EconomyConfig
    /**
     * Per-task overrides for the template (admin-customizable). Null falls
     * back to the template's bake-in defaults. Currently used to override
     * `pairChecklist` and `arenaDimensions` so an admin can pick which
     * boolean checks / GSB dimensions apply to this task. See
     * `getEffectiveTemplate()` for the merge.
     */
    templateConfig: jsonb('template_config'),
    status: taskStatusEnum('status').default('draft').notNull(),
    deadline: timestamp('deadline'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index('tasks_workspace_idx').on(table.workspaceId),
    statusIdx: index('tasks_status_idx').on(table.status),
  }),
)

// =================================================================
// Topics — one item per row; the unit of work an annotator picks up
// =================================================================
export const topics = pgTable(
  'topics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .references(() => tasks.id)
      .notNull(),
    itemData: jsonb('item_data').notNull(), // matches task's template itemSchema
    status: workflowStageEnum('status').default('drafting').notNull(),
    assignedTo: uuid('assigned_to').references(() => users.id),
    version: integer('version').default(1).notNull(), // optimistic concurrency
    /**
     * AI-estimated difficulty 1..5. Null = not estimated yet (legacy
     * topics + admins who opted out). Feeds the adaptive-pricing
     * multiplier: harder topics pay more.
     *
     * Set by the AI difficulty estimator (one-shot Claude call) at
     * topic-create time when the admin opts in. Once set, never
     * changes — if admin disagrees they can re-run estimation, but
     * the historical value is preserved in `events` via the audit
     * trail. (Phase-8.)
     */
    difficulty: integer('difficulty'),
    /** One-line AI rationale for the difficulty score. Surfaced in
     *  /my/queue and admin task pages so the call is interpretable. */
    difficultyReason: text('difficulty_reason'),
    /** When the estimator ran. Null mirrors `difficulty` null. */
    difficultyAt: timestamp('difficulty_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index('topics_task_idx').on(table.taskId),
    assignedIdx: index('topics_assigned_idx').on(table.assignedTo),
    statusIdx: index('topics_status_idx').on(table.status),
  }),
)

// =================================================================
// Annotations — one row per (topic, user) submission
// =================================================================
export const annotations = pgTable(
  'annotations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    topicId: uuid('topic_id')
      .references(() => topics.id)
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    payload: jsonb('payload').notNull(), // matches template responseSchema
    // For pair-annotation mode — Claude's initial proposal kept alongside human result
    claudeProposal: jsonb('claude_proposal'),
    deltaSummary: text('delta_summary'), // human-readable delta
    reasoningText: text('reasoning_text'), // human's CoT
    submittedAt: timestamp('submitted_at'),
    /**
     * Wall-clock timestamp the rater first started this annotation —
     * set on the FIRST saveDraft call, never overwritten. Combined
     * with `submittedAt` to derive time-on-task. Nullable to keep
     * legacy rows from before this column existed valid.
     */
    startedAt: timestamp('started_at'),
    /**
     * Time the rater actually spent on this annotation (seconds).
     * Computed at submit time as `submittedAt - startedAt`, clamped
     * to a sane range. Used by /quality to flag "5 seconds per topic"
     * water-army speeds. Nullable because draft-then-abandon entries
     * never get this set.
     */
    durationSec: integer('duration_sec'),
    version: integer('version').default(1).notNull(),
  },
  (table) => ({
    topicIdx: index('annotations_topic_idx').on(table.topicId),
    userIdx: index('annotations_user_idx').on(table.userId),
    /** Hot path: /my/quality + /my/earnings + invite-reward
     *  approval-count tally all filter (user_id, submitted_at NOT
     *  NULL). Composite is small (covered by user_id prefix) but
     *  lets the planner skip rows without a submission cheaply. */
    userSubmittedIdx: index('ann_user_submitted_idx').on(
      table.userId,
      table.submittedAt,
    ),
  }),
)

// =================================================================
// Events — append-only log (Pillar 2)
// =================================================================
export const events = pgTable(
  'events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: text('type').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    actorId: uuid('actor_id'),
    payload: jsonb('payload').notNull(),
    ts: timestamp('ts').defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index('events_workspace_idx').on(table.workspaceId),
    typeIdx: index('events_type_idx').on(table.type),
    tsIdx: index('events_ts_idx').on(table.ts),
    /** Maintenance pass — hot path: /audit, recent-events strip, and
     *  admin dashboards all filter workspace_id then range/order on ts.
     *  Composite avoids the planner falling back to bitmap-AND on the
     *  two single-column indexes. */
    wsTsIdx: index('events_ws_ts_idx').on(table.workspaceId, table.ts),
    /** Narrows the audit filter-chip queries (workspace + group/type
     *  + recent-window). */
    wsTypeTsIdx: index('events_ws_type_ts_idx').on(
      table.workspaceId,
      table.type,
      table.ts,
    ),
  }),
)

// =================================================================
// Gold standards — for trust-score calibration (Pillar of Self-Evolving Quality)
// =================================================================
export const goldStandards = pgTable(
  'gold_standards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .references(() => tasks.id)
      .notNull(),
    itemData: jsonb('item_data').notNull(),
    correctAnswer: jsonb('correct_answer').notNull(),
    explanation: text('explanation'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index('gold_task_idx').on(table.taskId),
  }),
)

// =================================================================
// Trust scores — per user × task type
// =================================================================
export const trustScores = pgTable(
  'trust_scores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /**
     * Workspace scope. Pre-Phase-9 the column didn't exist and trust
     * was per-(user × templateMode) GLOBAL. Now it's per-(user ×
     * workspace × templateMode) so a rater calibrated in one
     * workspace doesn't carry that prior into a different team's
     * task. Nullable for the brief migration window — readers
     * fall back to live query when null. New writes always set it.
     */
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    taskType: text('task_type').notNull(), // template mode
    /** Bayesian-smoothed raw rate ∈ [0, 1]. Same formula the live
     *  trust-consensus query uses; persisted so the hot read path
     *  doesn't have to re-scan events on every admin page load. */
    score: real('score').notNull().default(0.5),
    /**
     * EWMA-weighted score with 14-day half-life. Older approvals
     * count less. When a previously-trusted rater starts diverging,
     * `decayedScore` drops faster than `score` does — admins watch
     * the gap as a drift signal. Null on freshly-created rows;
     * filled on first recompute.
     */
    decayedScore: real('decayed_score'),
    sampleCount: integer('sample_count').default(0).notNull(),
    /** Total approved verdicts seen — for "X of Y approved" context. */
    approvedCount: integer('approved_count').default(0).notNull(),
    /** Total rejected verdicts seen — pairs with approvedCount. */
    rejectedCount: integer('rejected_count').default(0).notNull(),
    lastUpdated: timestamp('last_updated').defaultNow().notNull(),
  },
  (table) => ({
    userTaskIdx: index('trust_user_task_idx').on(table.userId, table.taskType),
    /** New scoped unique — at most one row per (user, workspace, mode). */
    userWsTaskUniq: uniqueIndex('trust_user_ws_task_uniq').on(
      table.userId,
      table.workspaceId,
      table.taskType,
    ),
  }),
)

// =================================================================
// Guidelines — versioned, evolving (Living Guidelines feature)
// =================================================================
export const guidelines = pgTable(
  'guidelines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .references(() => tasks.id)
      .notNull(),
    version: integer('version').notNull(),
    content: text('content').notNull(), // markdown
    parentVersionId: uuid('parent_version_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    taskVersionIdx: index('guidelines_task_version_idx').on(
      table.taskId,
      table.version,
    ),
  }),
)

// =================================================================
// Guideline patches — proposals to amend guidelines (from AI or annotators)
// =================================================================
export const guidelinePatches = pgTable('guideline_patches', {
  id: uuid('id').defaultRandom().primaryKey(),
  guidelineId: uuid('guideline_id')
    .references(() => guidelines.id)
    .notNull(),
  proposedBy: text('proposed_by').notNull(), // 'system' or user uuid as string
  patchContent: text('patch_content').notNull(),
  rationale: text('rationale'),
  status: text('status').default('pending').notNull(), // pending | accepted | rejected
  voteCount: integer('vote_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// =================================================================
// AI call log — per-user quota + cost accounting (security model: prevent
// runaway token spend by malicious or buggy clients).
// =================================================================
export const aiCallLog = pgTable(
  'ai_call_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** 'spec-generator' | 'pair-suggester' | 'guideline-refiner' | ... */
    feature: text('feature').notNull(),
    model: text('model').notNull(),
    tokensIn: integer('tokens_in').notNull(),
    tokensOut: integer('tokens_out').notNull(),
    costUsd: real('cost_usd'),
    /** Nullable: some calls are user-scoped only, not bound to a workspace */
    workspaceId: uuid('workspace_id'),
    ts: timestamp('ts').defaultNow().notNull(),
  },
  (table) => ({
    userTsIdx: index('ai_call_user_ts_idx').on(table.userId, table.ts),
  }),
)

// =================================================================
// API request log — every authenticated REST request to /api/ingest/* or
// /api/eval-runs gets a row here. Powers the API Usage dashboard +
// debugging + abuse detection.
//
// IP is stored as a SHA-256 prefix hash (16 hex chars) so we can detect
// patterns without retaining raw IPs (PII).
// =================================================================
export const apiRequestLog = pgTable(
  'api_request_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    /** Null if request was authenticated via user session (Eval-Run path) */
    apiKeyId: uuid('api_key_id').references(() => workspaceApiKeys.id),
    /** Null if request was machine-to-machine via API key */
    userId: uuid('user_id').references(() => users.id),
    /** "POST /api/ingest/trajectories" — endpoint name for grouping */
    endpoint: text('endpoint').notNull(),
    method: text('method').notNull(),
    status: integer('status').notNull(),
    durationMs: integer('duration_ms'),
    /** SHA-256 prefix (16 hex chars) of remote IP. No raw IP retained. */
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    payloadBytes: integer('payload_bytes'),
    responseBytes: integer('response_bytes'),
    /** Matches AppError.code on failure; null on success */
    errorCode: text('error_code'),
    ts: timestamp('ts').defaultNow().notNull(),
  },
  (table) => ({
    wsTsIdx: index('api_log_ws_ts_idx').on(table.workspaceId, table.ts),
    keyTsIdx: index('api_log_key_ts_idx').on(table.apiKeyId, table.ts),
    endpointTsIdx: index('api_log_endpoint_ts_idx').on(
      table.endpoint,
      table.ts,
    ),
  }),
)

// =================================================================
// Workspace API keys — for machine-to-machine (SDK / REST ingest) auth.
// Distinct from Supabase user sessions; workspace-scoped, hashed at rest.
// =================================================================
// =================================================================
// Workspace webhooks — outbound HTTP delivery for annotation events.
//
// When admin subscribes a URL, every matching workspace event triggers a
// best-effort POST. Signed via HMAC over the body using `secret` so the
// receiver can verify authenticity without sharing TLS infrastructure.
//
// Failure handling is intentionally simple: count consecutive failures
// in `failureCount`, auto-disable when it crosses a threshold (set by the
// fanout helper, not the schema). No retry queue at MVP scale.
// =================================================================
export const workspaceWebhooks = pgTable(
  'workspace_webhooks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** Where to POST event payloads. */
    url: text('url').notNull(),
    /** HMAC-SHA256 signing secret (~32 bytes base64). Shown to subscriber ONCE. */
    secret: text('secret').notNull(),
    /**
     * Array of event types this hook listens for. Empty → all annotation events.
     * Known types: 'annotation.approved' | 'annotation.rejected' |
     * 'annotation.revised' | 'annotation.submitted'
     */
    eventTypes: jsonb('event_types').default([]).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    createdBy: uuid('created_by')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /** Best-effort delivery telemetry — set by the fanout worker. */
    lastDeliveryAt: timestamp('last_delivery_at'),
    lastDeliveryStatus: integer('last_delivery_status'),
    failureCount: integer('failure_count').default(0).notNull(),
    /** Maintenance pass — exponential back-off. When set, fanout skips
     *  this hook until now() > nextRetryAt. Resets to NULL on the
     *  first successful delivery so a recovered receiver flows again
     *  without admin intervention. */
    nextRetryAt: timestamp('next_retry_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => ({
    workspaceIdx: index('webhooks_workspace_idx').on(table.workspaceId),
  }),
)

export const workspaceApiKeys = pgTable(
  'workspace_api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    name: text('name').notNull(), // user-readable label
    /** SHA-256 of the full bearer token; plain text shown ONCE on creation. */
    keyHash: text('key_hash').notNull().unique(),
    /** First 8 chars of the plain key for UI display (lh_ws_abcdefgh…). */
    prefix: text('prefix').notNull(),
    createdBy: uuid('created_by')
      .references(() => users.id)
      .notNull(),
    /**
     * Optional per-key RPM cap. NULL = no per-key limit (only the
     * connection-level limit applies). When set, the proxy enforces
     * BOTH: connection's limit AND this key's limit, whichever bites
     * first.
     *
     * Lets publishers issue a wide-open key for their own backend +
     * narrow keys for third-party integrations without having to fork
     * provider connections.
     */
    rateLimitRpm: integer('rate_limit_rpm'),
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index('api_keys_workspace_idx').on(table.workspaceId),
  }),
)

// =================================================================
// Provider connections — per-workspace credentials for upstream LLM APIs.
//
// Replaces the env-var pattern (ANTHROPIC_API_KEY / DOUBAO_API_KEY) for
// scalable multi-tenant operation: each workspace can have its own keys,
// own base URLs, own rate limits.
//
// The actual API key NEVER lives in this table. We store `vaultRef` — the
// name of a Supabase Vault secret. Reading the plaintext key requires the
// service-role connection + a query against `vault.decrypted_secrets`.
// =================================================================
export const providerConnections = pgTable(
  'provider_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** 'doubao' | 'anthropic' | 'openai' | 'deepseek' | 'qwen' | 'moonshot' | ... */
    providerKind: text('provider_kind').notNull(),
    /** Human-readable label, unique per workspace (e.g. "Doubao production"). */
    displayName: text('display_name').notNull(),
    /** Optional override of the provider's default base URL. */
    baseUrl: text('base_url'),
    /**
     * Reference to a Supabase Vault secret name. The plaintext key is fetched
     * via `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1`.
     */
    vaultRef: text('vault_ref').notNull(),
    /** Last-4 chars of the plain key for UI display (e.g. "…3a4b"). */
    keyDisplay: text('key_display'),
    /** Per-connection rate limits. null = no cap. */
    rateLimitRpm: integer('rate_limit_rpm'),
    rateLimitTpm: integer('rate_limit_tpm'),
    enabled: text('enabled').default('true').notNull(),
    rotatedAt: timestamp('rotated_at'),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (table) => ({
    wsKindIdx: index('prov_conn_ws_kind_idx').on(
      table.workspaceId,
      table.providerKind,
    ),
    wsNameUniq: uniqueIndex('prov_conn_ws_name_uniq').on(
      table.workspaceId,
      table.displayName,
    ),
  }),
)

// =================================================================
// Provider rate log — sliding-window bookkeeping for rate limits.
// Each row = one upstream call. The route handler counts rows in the
// last 60s (and sums tokensUsed for TPM) before deciding to accept the
// next call.
// =================================================================
export const providerRateLog = pgTable(
  'provider_rate_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id')
      .references(() => providerConnections.id)
      .notNull(),
    /**
     * Which API key triggered this call. Lets the rate-limiter count by
     * (connection × key) AND by (key alone), so a runaway third-party key
     * gets capped without affecting siblings sharing the same connection.
     * Nullable for forward-compat with old logged rows / non-keyed
     * call paths (e.g. internal admin scripts).
     */
    apiKeyId: uuid('api_key_id').references(() => workspaceApiKeys.id),
    ts: timestamp('ts').defaultNow().notNull(),
    tokensUsed: integer('tokens_used').default(0).notNull(),
  },
  (table) => ({
    connTsIdx: index('rate_log_conn_ts_idx').on(table.connectionId, table.ts),
  }),
)

// =================================================================
// Tool providers — per-workspace catalog of every tool agents use.
// Auto-created from observed traces (source='inferred'); publishers can
// upgrade to source='declared' with full manifest later.
// =================================================================
export const toolProviders = pgTable(
  'tool_providers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** 'function' | 'mcp' | 'skill' | 'cli' | 'api' (validated in code, not DB) */
    kind: text('kind').notNull(),
    /** Canonical identifier, e.g. 'mcp:postgres-query/execute' or 'cli:./deploy.sh' */
    identifier: text('identifier').notNull(),
    name: text('name').notNull(),
    manifest: jsonb('manifest').default({}).notNull(),
    /** 'inferred' (auto from traces) | 'declared' (publisher uploaded) */
    source: text('source').default('inferred').notNull(),
    status: text('status').default('active').notNull(),
    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
  (table) => ({
    // Composite unique: one identifier per workspace (enables upsert on conflict)
    wsIdentifierUniq: uniqueIndex('tool_providers_ws_id_uniq').on(
      table.workspaceId,
      table.identifier,
    ),
    wsKindIdx: index('tool_providers_ws_kind_idx').on(
      table.workspaceId,
      table.kind,
    ),
  }),
)

// =================================================================
// Trajectories — one row per agent run / annotation unit.
// =================================================================
export const trajectories = pgTable(
  'trajectories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** Optional: links a trajectory to an annotation task. Null until adopted. */
    taskId: uuid('task_id').references(() => tasks.id),
    /** 'production' | 'eval-run' | 'synthetic' | 'upload' */
    source: text('source').notNull(),
    agentName: text('agent_name').notNull(),
    rootPrompt: text('root_prompt').notNull(),
    finalResponse: text('final_response'),
    meta: jsonb('meta').default({}).notNull(),
    schemaVersion: text('schema_version').default('1.0').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /** Soft-delete timestamp — null means active. Queries filter on this unless includeDeleted=true. */
    deletedAt: timestamp('deleted_at'),
    /**
     * Cached Claude pre-annotation hints, keyed by step id. Computed lazily
     * via `reviewTrajectoryAndCache` and consumed by the annotator UI.
     * Shape: Array<{ stepId, rubricId, value, reason }>.
     * Null means "no review yet" — the /annotate page schedules an after()
     * job to populate this on first visit, so subsequent visits are instant.
     */
    claudeHints: jsonb('claude_hints'),
    claudeHintsAt: timestamp('claude_hints_at'),
    claudeHintsModel: text('claude_hints_model'),
    /**
     * Pure-function structured features extracted from steps. See
     * `src/lib/trajectories/extract-features.ts` for the shape:
     *   {stepCount, stepKindHistogram, toolUsage, uniqueTools,
     *    hasErrors, errorCount, loopDetected, durationMs,
     *    finalResponseChars, …}
     * Populated by extractFeatures() either at capture time (via after())
     * or via the backfill script. Shape evolves additively — readers
     * tolerate missing fields. Used as the lookup table for the /analyze
     * page's filter UI + the LLM batch-analyst.
     */
    features: jsonb('features').default({}).notNull(),
    /**
     * One-paragraph natural-language summary (~200 words) generated by
     * the fast-tier LLM. Cached forever — costs ~¥0.003 per trajectory,
     * not re-run on every analysis. Null until first request.
     */
    summary: text('summary'),
    summaryAt: timestamp('summary_at'),
    summaryModel: text('summary_model'),
  },
  (table) => ({
    wsIdx: index('trajectories_ws_idx').on(table.workspaceId),
    taskIdx: index('trajectories_task_idx').on(table.taskId),
    agentNameIdx: index('trajectories_agent_idx').on(table.agentName),
    /** Composite index for "active trajectories in workspace, most recent first" */
    wsCreatedActiveIdx: index('trajectories_ws_created_active_idx').on(
      table.workspaceId,
      table.deletedAt,
      table.createdAt,
    ),
  }),
)

// =================================================================
// Trajectory steps — each model thought, tool call, tool result, etc.
// `parentStepId` is null for linear (MVP) but exists day 1 for branching.
// =================================================================
export const trajectorySteps = pgTable(
  'trajectory_steps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    trajectoryId: uuid('trajectory_id')
      .references(() => trajectories.id)
      .notNull(),
    /** Self-reference for branching trees (counterfactuals); null = root linear */
    parentStepId: uuid('parent_step_id'),
    sequence: integer('sequence').notNull(),
    /** 'thinking' | 'tool_call' | 'tool_result' | 'sub_agent_call' | 'sub_agent_response' | 'final_response' | 'error' */
    kind: text('kind').notNull(),
    /** Kind-discriminated jsonb; validated by canonical schema at ingest */
    content: jsonb('content').notNull(),
    /** Set for tool_call/tool_result steps after provider resolution */
    toolProviderId: uuid('tool_provider_id').references(() => toolProviders.id),
    /** Agent-generated ID pairing tool_call ↔ tool_result */
    toolCallId: text('tool_call_id'),
    latencyMs: integer('latency_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    modelName: text('model_name'),
    ts: timestamp('ts').defaultNow().notNull(),
  },
  (table) => ({
    trajSeqIdx: index('steps_traj_seq_idx').on(
      table.trajectoryId,
      table.sequence,
    ),
    toolCallIdx: index('steps_traj_toolcall_idx').on(
      table.trajectoryId,
      table.toolCallId,
    ),
    toolProviderIdx: index('steps_provider_idx').on(table.toolProviderId),
  }),
)

// =================================================================
// Step annotations — fine-grained per-step marks attached to a top-level
// annotation row. Letting us join step ↔ annotation cleanly.
// =================================================================
export const stepAnnotations = pgTable(
  'step_annotations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    annotationId: uuid('annotation_id')
      .references(() => annotations.id)
      .notNull(),
    trajectoryStepId: uuid('trajectory_step_id')
      .references(() => trajectorySteps.id)
      .notNull(),
    /** Schema-driven by template; e.g. 'step_quality', 'tool_correctness', 'reasoning_quality' */
    kind: text('kind').notNull(),
    /** 1-5 Likert, nullable for boolean / categorical kinds */
    rating: integer('rating'),
    reasoning: text('reasoning').notNull(),
    /**
     * Canonical Mark JSON ({scale: 'likert' | 'bool' | 'enum' | 'text', value, reason?}).
     * Source of truth for non-likert marks (bool, enum, text) — `rating` +
     * `reasoning` are the legacy likert representation kept for back-compat.
     *
     * Historical note: this column was originally named `alt_suggestion` (for
     * "alternative annotator suggestion") before its semantics drifted to
     * "canonical mark JSON". Renamed in-place via ALTER COLUMN RENAME on
     * 2026-05-14 — no data lost, no row rewrite, just a clearer name.
     */
    payload: jsonb('payload'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    annotationIdx: index('step_ann_ann_idx').on(table.annotationId),
    stepIdx: index('step_ann_step_idx').on(table.trajectoryStepId),
  }),
)

// =================================================================
// Task topic scopes — Layer A guardrail.
// One scope per workspace (task_id NULL) or per task (task_id set).
// Lookup precedence: task-specific row > workspace fallback > none.
//
// The scope is auto-generated by Haiku from the task description at task
// creation time, and can be regenerated or edited by workspace admins.
// At /api/proxy/* request time, the resolved scope's `suffix` is prepended
// to the upstream system prompt — keeping the bound model "on-topic" so
// a leaked API key can't be repurposed as a general-purpose ChatGPT.
// =================================================================
export const taskTopicScopes = pgTable(
  'task_topic_scopes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** NULL = workspace-wide fallback; set = scope for this specific task. */
    taskId: uuid('task_id').references(() => tasks.id),
    /** Allowed topic phrases, e.g. ["medical questions", "drug interactions"]. */
    inScope: jsonb('in_scope').$type<string[]>().notNull(),
    /** Explicit out-of-scope categories used in the refusal language. */
    outOfScope: jsonb('out_of_scope').$type<string[]>().notNull(),
    /** Pre-rendered system-prompt suffix injected at proxy time. */
    suffix: text('suffix').notNull(),
    /** Bumps on every regeneration / manual edit. Surfaced in admin UI. */
    version: integer('version').default(1).notNull(),
    /** 'haiku' | 'admin-edit' | 'admin-manual'. */
    generatedBy: text('generated_by').notNull(),
    generatedAt: timestamp('generated_at').defaultNow().notNull(),
    /** Set when an admin manually overrode the AI-generated suffix. */
    manuallyEditedAt: timestamp('manually_edited_at'),
  },
  (table) => ({
    // One scope per (workspace, task) — task_id NULL is the workspace fallback,
    // task-specific rows override it. Postgres treats NULL as distinct in
    // unique indexes by default, so we use a partial unique index per case.
    wsFallbackUniq: uniqueIndex('topic_scopes_ws_fallback_uniq')
      .on(table.workspaceId)
      .where(sql`task_id IS NULL`),
    wsTaskUniq: uniqueIndex('topic_scopes_ws_task_uniq').on(
      table.workspaceId,
      table.taskId,
    ),
  }),
)

// =================================================================
// Settlement system — Phase 1
//
// The economy layer that turns approved annotations into actual payouts.
// Six tables, in dependency order:
//
//   payment_methods      ← annotator's payout destination (usdt addr, alipay id, etc.)
//   payout_periods       ← workspace-scoped calendar buckets (daily/weekly/monthly)
//   payout_line_items    ← one row per (annotation × payable rubric); the unit of accrual
//   payouts              ← aggregate per (period × user); the unit of payment
//   transactions         ← append-only money-movement ledger (earn / withdraw / penalty)
//   wallet_balance       ← materialized snapshot, periodically rebuilt from transactions
//
// Money is stored in INTEGER MINOR UNITS (cents / fen / 1e-6 USDT) — never floats.
// Currency is a per-row string field so multi-currency support is trivial.
//
// Approval flow:
//   annotation.submittedAt set → write a payout_line_item (status='pending')
//   admin or auto-rule approves → status='approved'
//   period boundary fires → aggregate approved line_items into a single payout row
//   admin marks paid (via Stripe/Alipay/USDT integration — currently stubbed) →
//     payout.status='paid', a transaction row of type='earn' lands in the ledger
//   annotator requests withdraw → transaction type='withdraw' (negative)
//
// Real payment-provider integration is OUT OF SCOPE for this competition build —
// `mark_paid` is a manual admin action. The data model + admin tooling is the
// hero; plumbing Stripe / Alipay merchant API is a follow-on.
// =================================================================

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** 'usdt' | 'alipay' | 'wechat' | 'bank' | 'stripe' (validated in code, not DB) */
    type: text('type').notNull(),
    /** USDT wallet addr / Alipay id / masked bank acct / Stripe Connect account id. */
    destination: text('destination').notNull(),
    /** Free-form display label the user chose ("Main USDT" / "Work account"). */
    label: text('label'),
    /** Set once verification (test transfer / micro-deposit / chain check) passes. */
    verifiedAt: timestamp('verified_at'),
    /** Default payout target when annotator doesn't pick one. */
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('payment_methods_user_idx').on(table.userId),
    /** One default per user — enforced at write-time in the action, not at DB level. */
  }),
)

export const payoutPeriods = pgTable(
  'payout_periods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    periodStart: timestamp('period_start').notNull(),
    periodEnd: timestamp('period_end').notNull(),
    /** 'open' = accepting line_items · 'closed' = aggregated, waiting payout · 'paid' = done */
    status: text('status').default('open').notNull(),
    /** When admin (or cron) flipped status to 'closed'. Set once. */
    closedAt: timestamp('closed_at'),
    /** When the last payout in this period was marked paid. Set once all payouts paid. */
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index('payout_periods_ws_idx').on(table.workspaceId),
    /** One open period per workspace — new line_items always land in the active period. */
    wsOpenUniq: uniqueIndex('payout_periods_ws_open_uniq')
      .on(table.workspaceId)
      .where(sql`status = 'open'`),
  }),
)

export const payoutLineItems = pgTable(
  'payout_line_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** The (workspace × user × period) bucket this line accrues into. */
    payoutPeriodId: uuid('payout_period_id')
      .references(() => payoutPeriods.id)
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** Provenance: the annotation row that generated this line. */
    annotationId: uuid('annotation_id')
      .references(() => annotations.id)
      .notNull(),
    /** Snapshot of task.rewardConfig at line-creation time. Survives later config edits. */
    economyType: text('economy_type').notNull(),
    currency: text('currency').notNull(),
    /** baseline payout per item, MINOR units. */
    baseAmountMinor: integer('base_amount_minor').notNull(),
    /** Trust-derived multiplier captured AT line creation. 100 = 1.00x; 250 = 2.50x. */
    qualityMultiplierBp: integer('quality_multiplier_bp').notNull(),
    /** Optional positive bumps (streak / gold-standard / early-bird). */
    bonusAmountMinor: integer('bonus_amount_minor').default(0).notNull(),
    /** Optional negative adjustments (clawback for overturned dispute, etc.). */
    penaltyAmountMinor: integer('penalty_amount_minor').default(0).notNull(),
    /** Final total = base × multiplier/100 + bonus - penalty. Computed at insert. */
    totalAmountMinor: integer('total_amount_minor').notNull(),
    /** 'pending' (awaiting approval) | 'approved' (in payout) | 'rejected' (excluded) | 'reversed' (clawback) */
    status: text('status').default('pending').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    periodIdx: index('payout_line_items_period_idx').on(table.payoutPeriodId),
    userIdx: index('payout_line_items_user_idx').on(table.userId),
    /** One line per annotation — re-submitting the same annotation updates instead of dupes. */
    annotationUniq: uniqueIndex('payout_line_items_annotation_uniq').on(
      table.annotationId,
    ),
  }),
)

export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    payoutPeriodId: uuid('payout_period_id')
      .references(() => payoutPeriods.id)
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** Sum of approved payout_line_items belonging to this (period × user). */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    /** 'pending' | 'approved' (admin signed off) | 'processing' (payment in flight) | 'paid' | 'failed' | 'reversed' */
    status: text('status').default('pending').notNull(),
    paymentMethodId: uuid('payment_method_id').references(
      () => paymentMethods.id,
    ),
    /** Stripe txn id / chain tx hash / bank wire ref. Set once paid. */
    externalRef: text('external_ref'),
    paidAt: timestamp('paid_at'),
    failedAt: timestamp('failed_at'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    periodIdx: index('payouts_period_idx').on(table.payoutPeriodId),
    userIdx: index('payouts_user_idx').on(table.userId),
    /** One payout per (period × user) — multiple users in a period each get their own row. */
    periodUserUniq: uniqueIndex('payouts_period_user_uniq').on(
      table.payoutPeriodId,
      table.userId,
    ),
  }),
)

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** 'earn' (positive, from payout) · 'withdraw' (negative, to bank/wallet) ·
     *  'tip' (positive, from publisher) · 'penalty' (negative, dispute clawback) ·
     *  'reversal' (negative, payout reversed) · 'adjustment' (admin manual fix). */
    type: text('type').notNull(),
    /** Signed integer MINOR units — positive for credits, negative for debits. */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    /** Which workspace's wallet this credits/debits. NULL = platform-wide (rare). */
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    /** Cross-reference into the entity that triggered this txn (payouts.id, etc.). */
    refTable: text('ref_table'),
    refId: uuid('ref_id'),
    /** Free-form note from the admin or system. */
    memo: text('memo'),
    ts: timestamp('ts').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('transactions_user_idx').on(table.userId),
    workspaceIdx: index('transactions_ws_idx').on(table.workspaceId),
    /** For wallet rebuild: scan user's txns in time order. */
    userTsIdx: index('transactions_user_ts_idx').on(table.userId, table.ts),
  }),
)

export const walletBalance = pgTable(
  'wallet_balance',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** NULL = cross-workspace global wallet (not used in MVP). */
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    currency: text('currency').notNull(),
    balanceMinor: integer('balance_minor').default(0).notNull(),
    /** Set every time we rebuild this row from transactions. */
    lastSettledAt: timestamp('last_settled_at').defaultNow().notNull(),
  },
  (table) => ({
    /** One row per (user, workspace, currency) — query "my CNY balance in workspace X". */
    triUniq: uniqueIndex('wallet_balance_uniq').on(
      table.userId,
      table.workspaceId,
      table.currency,
    ),
  }),
)

// =================================================================
// Annotation revisions — Phase-10 version history.
//
// Every meaningful save (autosave / explicit checkpoint / submit /
// admin restore) appends an immutable row here. That gives admins a
// time-machine to restore an annotation to a previous state when:
//   - rater accidentally cleared their work and the autosave already
//     overwrote the server-of-truth
//   - reviewer wants to compare what got submitted with what was in
//     flight an hour earlier (audit/forensics)
//   - rater hits 'restore' on a recent version from their own UI
//
// Storage discipline:
//   - 'autosave' rows are CAPPED at 20 most-recent per annotation;
//     older autosaves get pruned at write time so the table doesn't
//     bloat. A burst-clicking rater generates a lot of these and we
//     don't care to keep all of them.
//   - 'manual' (rater checkpoint), 'submit', and 'restore' rows are
//     NEVER pruned — those are the "memory points" an admin cares
//     about.
//   - byteSize column exists so we can sum + alarm if a payload
//     somehow explodes past expectations.
//
// Append-only — there's no UPDATE path. A restore writes a NEW row
// with kind='restore' and prevRevisionId pointing at the original.
// =================================================================
export const annotationRevisions = pgTable(
  'annotation_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    annotationId: uuid('annotation_id')
      .references(() => annotations.id)
      .notNull(),
    /** Who triggered the write. For autosave/submit/manual = the
     *  submitter. For restore = the admin who restored. */
    actorId: uuid('actor_id')
      .references(() => users.id)
      .notNull(),
    /** Denormalized so admin-side queries (per-workspace history
     *  list) don't need a 3-table join. */
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** Snapshot of the annotation payload at this moment. Same shape
     *  the annotation table stores. Capped at ~64KB by the form's
     *  template schemas. */
    payload: jsonb('payload').notNull(),
    /** What kind of save this was. 'autosave' rolls; the others stay. */
    kind: text('kind').notNull(),
    /** When restoring, points at the revision we restored FROM. Lets
     *  the history UI render a fork arrow. Null for non-restore rows. */
    prevRevisionId: uuid('prev_revision_id'),
    /** Bytes of `payload` after JSON-serialization. Used for storage
     *  budget reporting; not relied on for correctness. */
    byteSize: integer('byte_size').notNull(),
    ts: timestamp('ts').defaultNow().notNull(),
  },
  (table) => ({
    annTsIdx: index('annotation_revisions_ann_ts_idx').on(
      table.annotationId,
      table.ts,
    ),
    /** Pruning hot path: "find oldest autosave rows for this
     *  annotation to delete". */
    annKindTsIdx: index('annotation_revisions_ann_kind_ts_idx').on(
      table.annotationId,
      table.kind,
      table.ts,
    ),
    workspaceTsIdx: index('annotation_revisions_ws_ts_idx').on(
      table.workspaceId,
      table.ts,
    ),
  }),
)

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

// =================================================================
// Notifications — annotator-facing inbox
//
// Append-only feed of "things that happened to this user" — their
// annotation was rejected, someone replied in their review thread,
// admin approved their work, etc. Surfaced in /my/inbox and a small
// header bell with an unread badge.
//
// Why a dedicated table instead of projecting from `events`:
//   - events is workspace-scoped (actor + payload); to find "events
//     about user X" we'd need to scan + filter every workspace
//   - read state is per-recipient, not per-event
//   - we want a denormalized link_url + snippet so the inbox renders
//     fast without N+1 lookups
//   - notifications can be safely deleted (e.g. when underlying
//     annotation is hard-deleted); events stay immutable
//
// Notification types live in code (`NotificationType` in
// `lib/notifications/emit.ts`), not enum, so adding new ones doesn't
// need a migration.
// =================================================================
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Recipient — the user whose inbox this lands in. */
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** Workspace scope. Helps filter "show me only Acme inbox" and
     *  prevents cross-tenant leakage when a user is in multiple
     *  workspaces. */
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** Free-form type string ('annotation.rejected', 'review.reply',
     *  'annotation.approved', 'annotation.revising'). Kept as text
     *  not enum so adding new types is migration-free. */
    type: text('type').notNull(),
    /** Short human-readable title shown in the inbox list. */
    title: text('title').notNull(),
    /** Optional 1-line preview (annotation snippet, reviewer reply
     *  excerpt, etc.). Kept short — UI truncates beyond ~120 chars. */
    body: text('body'),
    /** Where clicking the notification jumps to (review page,
     *  submissions list, etc.). Stored denormalized so we don't
     *  re-resolve routes on render. */
    linkUrl: text('link_url').notNull(),
    /** Free-form payload for the UI to render richer states later
     *  (e.g. show the verdict color, render a snippet diff). */
    payload: jsonb('payload').default({}).notNull(),
    /** Who triggered this notification (reviewer / admin). Null for
     *  system-generated ones (auto-approval, etc.). Useful in the
     *  inbox row for "from X". */
    actorId: uuid('actor_id').references(() => users.id),
    /** When the recipient marked the notification as read. Null = unread. */
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    /** Hot path: count + list unread for current user. */
    userUnreadIdx: index('notifications_user_unread_idx')
      .on(table.userId, table.readAt),
    /** Hot path: list-by-date for current user. */
    userCreatedIdx: index('notifications_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
  }),
)

// =================================================================
// Dataset versions — Phase-14.
//
// Admin "freezes" the current set of approved annotations into a
// labeled snapshot ("v1", "v2", …). The manifest is a fully self-
// contained jsonb array of {annotationId, topicId, taskId, payload,
// userId, submittedAt, approvedAt} — readers can rebuild the
// historical dataset without joining live tables (which may have
// changed via restore / revision / soft-delete since).
//
// Why a jsonb manifest instead of a join table:
//   - Future-proof against schema drift — a manifest snapshot doesn't
//     break if annotations.payload's shape changes.
//   - Read path is one row → one parse, not a 4-way join per export.
//   - Bytes are bounded by the count cap (5k items/version) so the
//     row stays under Postgres's 1GB cell limit comfortably.
//
// Tradeoffs:
//   - We're storing data twice (annotations rows + manifest copy).
//     Acceptable: the manifest IS the contract — that's the point of
//     a versioned export.
//   - The manifest doesn't include trajectory_steps / step_annotations.
//     Trajectory exports stay on the legacy /api/export/trajectories
//     route; this surface is for the pair/arena/agent-trace payload
//     modes whose dataset is one annotation per row.
// =================================================================
export const datasetVersions = pgTable(
  'dataset_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** Admin-chosen or auto-generated ("v1", "v2", …). Unique per ws. */
    label: text('label').notNull(),
    /** Optional admin note about why this version was frozen
     *  ("after rubric v3 retraining"). */
    description: text('description'),
    /** Count of items in the manifest — denormalized so the list view
     *  doesn't have to parse the manifest just to show "N items". */
    itemCount: integer('item_count').notNull(),
    /** The frozen content. Array of:
     *    { annotationId, topicId, taskId, userId, payload,
     *      submittedAt, approvedAt, templateMode } */
    manifest: jsonb('manifest').notNull(),
    /** Size of the serialized manifest in bytes — admin sees this on
     *  the version card for storage planning. */
    byteSize: integer('byte_size').notNull(),
    /** Admin who clicked freeze. Null only for system seeds. */
    frozenBy: uuid('frozen_by').references(() => users.id),
    frozenAt: timestamp('frozen_at').defaultNow().notNull(),
  },
  (table) => ({
    /** No two versions share a label inside one workspace. */
    wsLabelUniq: uniqueIndex('dataset_versions_ws_label_uniq').on(
      table.workspaceId,
      table.label,
    ),
    wsFrozenIdx: index('dataset_versions_ws_frozen_idx').on(
      table.workspaceId,
      table.frozenAt,
    ),
  }),
)

// =================================================================
// Invite-reward automation — Phase-13.
//
// When an admin approves the Nth (default 5) annotation from a user
// who originally joined via someone else's invite, the inviter earns
// a flat reward (¥200 default) credited to their workspace wallet.
//
// One row per (inviter, invitee, workspace) — unique index prevents
// double-credit. Status machine:
//
//   pending        — invitee joined but hasn't crossed the threshold yet
//                    (row may not exist at this stage; we insert at trigger)
//   manual_review  — anti-abuse rule fired (same email domain, suspended
//                    inviter, or fast-burst threshold); admin must
//                    approve or block
//   granted        — credit posted, wallet incremented, invitee notified
//   blocked        — admin denied (counts as resolved; no retry)
//
// Money-path table — see /docs (and the Phase-13 audit) for the threat
// model. Triggered out-of-band via `after()` in the approval action so
// the verdict commit is never blocked.
// =================================================================
export const inviteRewards = pgTable(
  'invite_rewards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inviterUserId: uuid('inviter_user_id')
      .references(() => users.id)
      .notNull(),
    inviteeUserId: uuid('invitee_user_id')
      .references(() => users.id)
      .notNull(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** 'pending' | 'manual_review' | 'granted' | 'blocked' */
    status: text('status').notNull().default('pending'),
    /** Why the row is in manual_review / blocked. Surfaced verbatim to
     *  the admin queue and stored in audit. */
    blockReason: text('block_reason'),
    /** Frozen at row-create time so a reward setting change later
     *  doesn't retroactively change historical amounts. */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    /** The Nth approved annotation that pushed the invitee over the
     *  threshold — useful for the audit trail ("this row was created
     *  because annotation X got approved"). Nullable because admin-
     *  granted rows might not reference a specific annotation. */
    triggerAnnotationId: uuid('trigger_annotation_id').references(
      () => annotations.id,
    ),
    /** When the credit actually hit the wallet. Null until granted. */
    grantedAt: timestamp('granted_at'),
    /** Admin who manually approved / denied. Null for auto-grant rows. */
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    /** Idempotency anchor — never double-credit the same pair in the
     *  same workspace. The trigger flow ON CONFLICT-no-ops on this. */
    pairUniq: uniqueIndex('invite_rewards_pair_uniq').on(
      table.inviterUserId,
      table.inviteeUserId,
      table.workspaceId,
    ),
    inviterIdx: index('invite_rewards_inviter_idx').on(
      table.inviterUserId,
      table.createdAt,
    ),
    workspaceIdx: index('invite_rewards_workspace_idx').on(
      table.workspaceId,
      table.status,
    ),
  }),
)

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

// =================================================================
// Relations
// =================================================================
export const usersRelations = relations(users, ({ many }) => ({
  workspaces: many(workspaces),
  annotations: many(annotations),
  trustScores: many(trustScores),
}))

export const workspacesRelations = relations(workspaces, ({ many, one }) => ({
  admin: one(users, { fields: [workspaces.adminId], references: [users.id] }),
  tasks: many(tasks),
}))

export const tasksRelations = relations(tasks, ({ many, one }) => ({
  workspace: one(workspaces, {
    fields: [tasks.workspaceId],
    references: [workspaces.id],
  }),
  topics: many(topics),
  goldStandards: many(goldStandards),
  guidelines: many(guidelines),
}))

export const topicsRelations = relations(topics, ({ many, one }) => ({
  task: one(tasks, { fields: [topics.taskId], references: [tasks.id] }),
  assignee: one(users, {
    fields: [topics.assignedTo],
    references: [users.id],
  }),
  annotations: many(annotations),
}))

export const annotationsRelations = relations(annotations, ({ one }) => ({
  topic: one(topics, {
    fields: [annotations.topicId],
    references: [topics.id],
  }),
  user: one(users, { fields: [annotations.userId], references: [users.id] }),
}))

export const guidelinesRelations = relations(guidelines, ({ many, one }) => ({
  task: one(tasks, { fields: [guidelines.taskId], references: [tasks.id] }),
  patches: many(guidelinePatches),
}))

// ── Trajectory relations ────────────────────────────────────────────────
export const trajectoriesRelations = relations(
  trajectories,
  ({ many, one }) => ({
    workspace: one(workspaces, {
      fields: [trajectories.workspaceId],
      references: [workspaces.id],
    }),
    task: one(tasks, {
      fields: [trajectories.taskId],
      references: [tasks.id],
    }),
    steps: many(trajectorySteps),
  }),
)

export const trajectoryStepsRelations = relations(
  trajectorySteps,
  ({ one, many }) => ({
    trajectory: one(trajectories, {
      fields: [trajectorySteps.trajectoryId],
      references: [trajectories.id],
    }),
    toolProvider: one(toolProviders, {
      fields: [trajectorySteps.toolProviderId],
      references: [toolProviders.id],
    }),
    stepAnnotations: many(stepAnnotations),
  }),
)

export const stepAnnotationsRelations = relations(stepAnnotations, ({ one }) => ({
  annotation: one(annotations, {
    fields: [stepAnnotations.annotationId],
    references: [annotations.id],
  }),
  step: one(trajectorySteps, {
    fields: [stepAnnotations.trajectoryStepId],
    references: [trajectorySteps.id],
  }),
}))

export const toolProvidersRelations = relations(toolProviders, ({ many }) => ({
  steps: many(trajectorySteps),
}))

/**
 * Finals P1 — Designer-saved form schemas.
 *
 * Spec 4.2: the Designer outputs a JSON-Schema-shaped FormSchema; we
 * persist one row per saved schema and reference it from
 * `templateConfig.formSchemaId` on a task's template config. Tables
 * live behind workspace_id for the standard isolation guard.
 *
 * `schema` is the canonical FormSchema (`src/lib/form-designer/schema`)
 * stored as jsonb; the Renderer hydrates it via the
 * `src/lib/form-designer/serialize.ts` round-trip if the consumer
 * wants the draft-07 projection.
 */
export const customFormSchemas = pgTable(
  'custom_form_schemas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    label: text('label').notNull(),
    schema: jsonb('schema').notNull(),
    version: integer('version').notNull().default(1),
    /**
     * Finals D21-B — append-only schema chain. When the Designer
     * "saves a new version" of a schema, we INSERT a new row with
     * a fresh id + version+1 + previous_id pointing at the prior
     * row. The prior row stays immutable so any task pinned to
     * its id keeps rendering the same schema even after the owner
     * edits. closes spec section 5 "schema 版本管理".
     */
    previousId: uuid('previous_id').references(
      (): import('drizzle-orm/pg-core').AnyPgColumn => customFormSchemas.id,
    ),
    /**
     * Finals D21-B — workspace template gallery. When true, the
     * schema surfaces in the Designer's "Start from template"
     * dropdown alongside OFFICIAL_TEMPLATES so the next form the
     * PM builds can start from a workspace-curated baseline.
     */
    isTemplate: boolean('is_template').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    archivedAt: timestamp('archived_at'),
  },
  (t) => ({
    wsIdx: index('custom_form_schemas_ws_idx').on(t.workspaceId, t.archivedAt),
    workspaceTemplateIdx: index(
      'custom_form_schemas_workspace_template_idx',
    ).on(t.workspaceId, t.isTemplate),
    previousIdIdx: index('custom_form_schemas_previous_id_idx').on(
      t.previousId,
    ),
  }),
)

export const customFormSchemasRelations = relations(
  customFormSchemas,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [customFormSchemas.workspaceId],
      references: [workspaces.id],
    }),
    createdByUser: one(users, {
      fields: [customFormSchemas.createdBy],
      references: [users.id],
    }),
  }),
)

/**
 * Finals P2 — Per-submission AI Review Agent verdicts.
 *
 * Spec 4.4: each annotation submit fires an after-hook that calls the
 * owner-configured AI Agent, which returns a structured verdict
 * (pass / send_back / human_review) with scoring dimensions. One row
 * per verdict; `idempotency_key` prevents duplicate runs from
 * re-submits.
 */
export const aiSubmissionVerdicts = pgTable(
  'ai_submission_verdicts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    annotationId: uuid('annotation_id')
      .notNull()
      .references(() => annotations.id),
    judgeId: uuid('judge_id').references(() => llmJudges.id),
    status: text('status').notNull().default('pending'),
    verdict: text('verdict'),
    scores: jsonb('scores'),
    reasoning: text('reasoning'),
    attempts: integer('attempts').notNull().default(0),
    errorText: text('error_text'),
    idempotencyKey: text('idempotency_key').notNull(),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    finishedAt: timestamp('finished_at'),
  },
  (t) => ({
    idempotencyUniq: uniqueIndex('ai_verdicts_idempotency_uniq').on(
      t.idempotencyKey,
    ),
    annotationIdx: index('ai_verdicts_annotation_idx').on(
      t.annotationId,
      t.startedAt,
    ),
    statusIdx: index('ai_verdicts_status_idx').on(t.status, t.startedAt),
  }),
)

/**
 * Finals P4 — Async export job queue.
 *
 * Spec 4.6: multi-format dataset export. Small jobs stream inline;
 * larger ones enqueue a row here so a worker (or a Vercel cron) can
 * process and upload to Supabase Storage. `storage_path` is the
 * resulting bucket key the API hands back to the user.
 */
export const exportJobs = pgTable(
  'export_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    createdBy: uuid('created_by').references(() => users.id),
    format: text('format').notNull(),
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('pending'),
    rowCount: integer('row_count'),
    byteSize: integer('byte_size'),
    storagePath: text('storage_path'),
    errorText: text('error_text'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    finishedAt: timestamp('finished_at'),
  },
  (t) => ({
    wsIdx: index('export_jobs_ws_idx').on(t.workspaceId, t.createdAt),
    statusIdx: index('export_jobs_status_idx').on(t.status, t.createdAt),
  }),
)
