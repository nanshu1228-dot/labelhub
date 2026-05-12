import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  real,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

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
  'reviewing',
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
  adminId: uuid('admin_id')
    .references(() => users.id)
    .notNull(),
  settings: jsonb('settings').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

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
    version: integer('version').default(1).notNull(),
  },
  (table) => ({
    topicIdx: index('annotations_topic_idx').on(table.topicId),
    userIdx: index('annotations_user_idx').on(table.userId),
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
    taskType: text('task_type').notNull(), // template mode
    score: real('score').notNull().default(0.5), // 0-1, TrustAL-inspired
    sampleCount: integer('sample_count').default(0).notNull(),
    lastUpdated: timestamp('last_updated').defaultNow().notNull(),
  },
  (table) => ({
    userTaskIdx: index('trust_user_task_idx').on(table.userId, table.taskType),
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
    /** "This step should have been ..." — replaces / suggests alternative */
    altSuggestion: jsonb('alt_suggestion'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    annotationIdx: index('step_ann_ann_idx').on(table.annotationId),
    stepIdx: index('step_ann_step_idx').on(table.trajectoryStepId),
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
